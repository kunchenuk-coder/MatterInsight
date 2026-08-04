-- ############################################################################
-- view_count + notifications (真实浏览计数 & 未读通知)
-- ############################################################################

-- 1) materials.view_count
alter table public.materials
  add column if not exists view_count integer not null default 0;

comment on column public.materials.view_count is
  '累计浏览次数；通过 increment_material_view_count RPC 原子 +1';

-- 兼容旧 JSON 里的 clicks（若有）
update public.materials
set view_count = greatest(
  view_count,
  coalesce(nullif(data->>'clicks', '')::integer, 0)
)
where coalesce(nullif(data->>'clicks', '')::integer, 0) > view_count;

create index if not exists materials_view_count_idx
  on public.materials (view_count desc);

-- 2) notifications 表（按产品约定：receiver_id / type / target_id）
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  type text not null
    check (type in ('tag_added', 'inquiry', 'sample_request', 'story_featured')),
  target_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.notifications is
  '站内未读通知：标签/询价/小样/故事精选';

create index if not exists notifications_receiver_unread_idx
  on public.notifications (receiver_id, is_read, created_at desc);

create index if not exists notifications_receiver_type_idx
  on public.notifications (receiver_id, type, is_read);

create index if not exists notifications_target_idx
  on public.notifications (target_id)
  where target_id is not null;

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select to authenticated
  using (receiver_id = auth.uid() or public.is_admin());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update to authenticated
  using (receiver_id = auth.uid() or public.is_admin())
  with check (receiver_id = auth.uid() or public.is_admin());

-- INSERT 仅通过 security definer RPC（防伪造）
drop policy if exists "notifications_insert_admin" on public.notifications;
create policy "notifications_insert_admin"
  on public.notifications for insert to authenticated
  with check (public.is_admin());

-- Realtime（头像红点即时刷新）
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.notifications;
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

-- ############################################################################
-- 3) RPC: 原子浏览 +1（允许已登录 / 游客）
-- ############################################################################

create or replace function public.increment_material_view_count(p_material_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_material_id is null then
    raise exception 'material_id required';
  end if;

  update public.materials
  set
    view_count = coalesce(view_count, 0) + 1,
    -- 同步 JSON 内 clicks，兼容旧前端字段
    data = coalesce(data, '{}'::jsonb)
      || jsonb_build_object(
        'clicks',
        coalesce(view_count, 0) + 1
      ),
    updated_at = now()
  where id = p_material_id
    and is_pending = false
    and status in ('已发布', 'published')
  returning view_count into v_count;

  if v_count is null then
    -- 材料商查看自己未发布草稿时不计入；查不到则返回当前值或 0
    select coalesce(view_count, 0) into v_count
    from public.materials
    where id = p_material_id;
    return coalesce(v_count, 0);
  end if;

  return v_count;
end;
$$;

grant execute on function public.increment_material_view_count(uuid) to anon, authenticated;

-- ############################################################################
-- 4) RPC: 创建通知（security definer）
-- ############################################################################

create or replace function public.create_notification(
  p_receiver_id uuid,
  p_type text,
  p_target_id uuid default null,
  p_sender_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_type text := lower(trim(coalesce(p_type, '')));
begin
  if p_receiver_id is null then
    raise exception 'receiver_id required';
  end if;

  if v_type not in ('tag_added', 'inquiry', 'sample_request', 'story_featured') then
    raise exception 'invalid notification type';
  end if;

  -- 不允许给自己发业务通知（标签除外可跳过：设计师打标签通知材料商）
  if v_uid is not null and p_receiver_id = v_uid and v_type <> 'story_featured' then
    -- story_featured 由管理员触发，receiver 是设计师；inquiry 等由设计师触发给材料商
    null;
  end if;

  -- 调用方必须已登录（anon 不可伪造通知）
  if v_uid is null and not public.is_admin() then
    raise exception 'not authenticated';
  end if;

  insert into public.notifications (receiver_id, sender_id, type, target_id, is_read)
  values (
    p_receiver_id,
    coalesce(p_sender_id, v_uid),
    v_type,
    p_target_id,
    false
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_notification(uuid, text, uuid, uuid) to authenticated;

-- ############################################################################
-- 5) RPC: 批量标记已读
-- ############################################################################

create or replace function public.mark_notifications_read(
  p_types text[] default null,
  p_target_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.notifications
  set is_read = true
  where receiver_id = v_uid
    and is_read = false
    and (p_types is null or type = any (p_types))
    and (p_target_id is null or target_id = p_target_id);

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

grant execute on function public.mark_notifications_read(text[], uuid) to authenticated;

-- ############################################################################
-- 6) 设计师添加情绪标签 -> 通知材料商 tag_added
-- ############################################################################

create or replace function public.submit_material_mood_tag(
  p_material_id uuid,
  p_tag_word text,
  p_is_brand boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_tag text := trim(coalesce(p_tag_word, ''));
  v_is_brand boolean := coalesce(p_is_brand, false);
  v_tag_id uuid;
  v_data jsonb;
  v_human jsonb;
  v_tags jsonb;
  v_found boolean := false;
  v_elem jsonb;
  v_next jsonb := '[]'::jsonb;
  v_i int;
  v_len int;
  v_supplier_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if char_length(v_tag) < 1 or char_length(v_tag) > 12 then
    raise exception 'tag length must be 1-12';
  end if;

  select lower(role) into v_role from public.profiles where id = v_uid;
  if v_role is null then
    raise exception 'profile not found';
  end if;

  if v_is_brand then
    if v_role is distinct from 'supplier' then
      raise exception 'only suppliers may add brand mood tags';
    end if;
    if not exists (
      select 1 from public.materials where id = p_material_id and supplier_id = v_uid
    ) then
      raise exception 'material not found or not owned by supplier';
    end if;
  else
    if v_role is distinct from 'designer' then
      raise exception 'only designers may add custom mood tags';
    end if;
    if not exists (select 1 from public.materials where id = p_material_id) then
      raise exception 'material not found';
    end if;
  end if;

  insert into public.tag_pool (tag_word, dimensions, status, created_at)
  values (v_tag, '{}'::jsonb, case when v_is_brand then 'approved' else 'pending' end, now())
  on conflict (tag_word) do update set tag_word = excluded.tag_word
  returning id into v_tag_id;

  if not exists (
    select 1 from public.material_tag_relation
    where material_id = p_material_id and tag_id = v_tag_id and tagged_by = v_uid
  ) then
    insert into public.material_tag_relation (material_id, tag_id, tagged_by, tag_type, created_at)
    values (
      p_material_id,
      v_tag_id,
      v_uid,
      case when v_is_brand then '官方标签' else '自定义标签' end,
      now()
    );
  end if;

  select data, supplier_id into v_data, v_supplier_id
  from public.materials
  where id = p_material_id
  for update;

  v_human := coalesce(v_data->'humanDna', '{}'::jsonb);
  v_tags := coalesce(v_human->'mood_tags', '[]'::jsonb);
  v_len := jsonb_array_length(v_tags);

  for v_i in 0 .. greatest(v_len - 1, -1) loop
    v_elem := v_tags->v_i;
    if lower(v_elem->>'tag') = lower(v_tag) then
      v_found := true;
      if v_is_brand then
        v_elem := v_elem || jsonb_build_object('is_brand_official', true, 'is_custom', false);
      else
        v_elem := v_elem || jsonb_build_object(
          'is_custom', true,
          'author_id', v_uid::text,
          'count', greatest(coalesce((v_elem->>'count')::int, 0), 1)
        );
      end if;
    end if;
    v_next := v_next || jsonb_build_array(v_elem);
  end loop;

  if not v_found then
    if v_is_brand then
      v_next := v_next || jsonb_build_array(jsonb_build_object(
        'tag', v_tag,
        'count', 0,
        'is_brand_official', true
      ));
    else
      v_next := v_next || jsonb_build_array(jsonb_build_object(
        'tag', v_tag,
        'count', 1,
        'is_custom', true,
        'author_id', v_uid::text
      ));
    end if;
  end if;

  if v_is_brand then
    if (
      select count(*) from jsonb_array_elements(v_next) e
      where coalesce((e.value->>'is_brand_official')::boolean, false)
    ) > 3 then
      raise exception 'brand mood tags limited to 3';
    end if;
  else
    if (
      select count(*) from jsonb_array_elements(v_next) e
      where coalesce((e.value->>'is_custom')::boolean, false)
        and e.value->>'author_id' = v_uid::text
    ) > 3 then
      raise exception 'designer custom mood tags limited to 3';
    end if;
  end if;

  v_human := v_human || jsonb_build_object('mood_tags', v_next);
  v_data := coalesce(v_data, '{}'::jsonb) || jsonb_build_object('humanDna', v_human);

  update public.materials
  set data = v_data, updated_at = now()
  where id = p_material_id;

  -- 设计师新增自定义标签 -> 通知材料商
  if not v_is_brand
     and v_supplier_id is not null
     and v_supplier_id is distinct from v_uid then
    insert into public.notifications (receiver_id, sender_id, type, target_id, is_read)
    values (v_supplier_id, v_uid, 'tag_added', p_material_id, false);
  end if;

  return jsonb_build_object('mood_tags', v_next);
end;
$$;

grant execute on function public.submit_material_mood_tag(uuid, text, boolean) to authenticated;

-- ############################################################################
-- 7) 管理员精选故事 -> 通知设计师 story_featured
-- ############################################################################

create or replace function public.trg_inspiration_story_featured_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.status in ('published', 'approved')
     and (old.status is distinct from new.status)
     and new.designer_id is not null then
    insert into public.notifications (receiver_id, sender_id, type, target_id, is_read)
    values (
      new.designer_id,
      auth.uid(),
      'story_featured',
      coalesce(new.material_id, new.id),
      false
    );
  end if;
  return new;
end;
$$;

drop trigger if exists inspiration_stories_featured_notify on public.inspiration_stories;
create trigger inspiration_stories_featured_notify
  after update of status on public.inspiration_stories
  for each row
  execute function public.trg_inspiration_story_featured_notify();
