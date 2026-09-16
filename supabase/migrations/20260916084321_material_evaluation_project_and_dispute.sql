-- 扩展 material_designer_evaluations：项目名 / 承诺 / 状态
-- RPC：提交（含承诺）、更新评分、材料商复议、管理员改状态
-- 通知：evaluation_added（材料商）、evaluation_disputed（Admin）

-- ========== 1. 表字段 ==========
alter table public.material_designer_evaluations
  add column if not exists project_name text,
  add column if not exists project_adoption_id uuid,
  add column if not exists commitment_confirmed boolean not null default false,
  add column if not exists status text not null default 'submitted',
  add column if not exists disputed_at timestamptz,
  add column if not exists disputed_by uuid,
  add column if not exists updated_at timestamptz not null default now();

alter table public.material_designer_evaluations
  drop constraint if exists material_designer_evaluations_status_check;
alter table public.material_designer_evaluations
  add constraint material_designer_evaluations_status_check
  check (status in ('submitted', 'disputed', 'revoked'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'material_designer_evaluations_adoption_fk'
  ) then
    alter table public.material_designer_evaluations
      add constraint material_designer_evaluations_adoption_fk
      foreign key (project_adoption_id)
      references public.material_project_adoptions(id)
      on delete set null;
  end if;
exception
  when undefined_table then
    null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'material_designer_evaluations_disputed_by_fk'
  ) then
    alter table public.material_designer_evaluations
      add constraint material_designer_evaluations_disputed_by_fk
      foreign key (disputed_by)
      references public.profiles(id)
      on delete set null;
  end if;
end $$;

-- ========== 2. 通知类型白名单 ==========
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'tag_added',
    'inquiry',
    'sample_request',
    'story_featured',
    'quote_received',
    'project_adoption_approved',
    'story_pending_review',
    'evaluation_added',
    'evaluation_disputed'
  ));

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

  if v_type not in (
    'tag_added',
    'inquiry',
    'sample_request',
    'story_featured',
    'quote_received',
    'project_adoption_approved',
    'story_pending_review',
    'evaluation_added',
    'evaluation_disputed'
  ) then
    raise exception 'invalid notification type';
  end if;

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

-- ========== 3. 工具：材料名 / 通知 target / 重算综合分 ==========
create or replace function public.material_display_name(p_material_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_data jsonb;
  v_name text;
begin
  select data into v_data from public.materials where id::text = p_material_id;
  if v_data is null then
    return '项目应用';
  end if;
  if jsonb_typeof(v_data->'name') = 'string' then
    v_name := nullif(trim(v_data->>'name'), '');
  elsif jsonb_typeof(v_data->'name') = 'object' then
    v_name := coalesce(
      nullif(trim(v_data->'name'->>'zh'), ''),
      nullif(trim(v_data->'name'->>'en'), '')
    );
  end if;
  return coalesce(v_name, '项目应用');
end;
$$;

create or replace function public.material_display_name(p_material_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public.material_display_name(p_material_id::text);
end;
$$;

create or replace function public.try_material_uuid(p_material_id text)
returns uuid
language plpgsql
immutable
as $$
begin
  return p_material_id::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

create or replace function public.recompute_material_evaluation_aggregate(p_material_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb;
  v_human jsonb;
  v_next jsonb := '{}'::jsonb;
  v_count integer := 0;
  v_key text;
  v_avg numeric;
begin
  select count(*)::integer into v_count
  from public.material_designer_evaluations
  where material_id = p_material_id
    and status is distinct from 'revoked';

  for v_key in select unnest(array['aesthetics','durability','service','cleanliness','recommendation']) loop
    if v_count = 0 then
      v_avg := 4.0;
    else
      select round(avg((evaluations->>v_key)::numeric), 1) into v_avg
      from public.material_designer_evaluations
      where material_id = p_material_id
        and status is distinct from 'revoked';
    end if;
    v_next := v_next || jsonb_build_object(v_key, coalesce(v_avg, 4.0));
  end loop;

  select data into v_data from public.materials where id::text = p_material_id for update;
  if not found then
    raise exception 'material not found';
  end if;

  v_human := coalesce(v_data->'humanDna', '{}'::jsonb)
    || jsonb_build_object('evaluations', v_next)
    || jsonb_build_object('evaluation_vote_count', v_count);

  v_data := v_data || jsonb_build_object('humanDna', v_human)
    || jsonb_build_object(
      'ratings',
      jsonb_build_object(
        'aesthetic', (v_next->>'aesthetics')::numeric,
        'durable', (v_next->>'durability')::numeric,
        'service', (v_next->>'service')::numeric,
        'cleanliness', (v_next->>'cleanliness')::numeric,
        'recommendation', (v_next->>'recommendation')::numeric
      )
    );

  update public.materials
  set data = v_data, updated_at = now()
  where id::text = p_material_id;

  return v_next || jsonb_build_object('evaluation_vote_count', v_count);
end;
$$;

create or replace function public.evaluation_is_low(p_evaluations jsonb)
returns boolean
language sql
immutable
as $$
  select (
    coalesce((p_evaluations->>'aesthetics')::numeric, 5)
    + coalesce((p_evaluations->>'durability')::numeric, 5)
    + coalesce((p_evaluations->>'service')::numeric, 5)
    + coalesce((p_evaluations->>'cleanliness')::numeric, 5)
    + coalesce((p_evaluations->>'recommendation')::numeric, 5)
  ) / 5.0 < 2.0
  or least(
    coalesce((p_evaluations->>'aesthetics')::numeric, 5),
    coalesce((p_evaluations->>'durability')::numeric, 5),
    coalesce((p_evaluations->>'service')::numeric, 5),
    coalesce((p_evaluations->>'cleanliness')::numeric, 5),
    coalesce((p_evaluations->>'recommendation')::numeric, 5)
  ) <= 1.0;
$$;

create or replace function public.notify_admins_evaluation_disputed(
  p_eval_id uuid,
  p_sender uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
begin
  for v_admin in
    select p.id from public.profiles p
    where lower(p.role) = 'admin'
      and p.id is distinct from p_sender
  loop
    insert into public.notifications (receiver_id, sender_id, type, target_id, is_read)
    values (v_admin, p_sender, 'evaluation_disputed', p_eval_id, false);
  end loop;
end;
$$;

-- ========== 4. 提交评分（替换 2 参版本，新增可选参数） ==========
drop function if exists public.submit_material_evaluation(text, jsonb);

create or replace function public.submit_material_evaluation(
  p_material_id text,
  p_evaluations jsonb,
  p_project_name text default null,
  p_commitment_confirmed boolean default false,
  p_project_adoption_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_eval_id uuid;
  v_project text;
  v_adoption uuid;
  v_supplier uuid;
  v_target uuid;
  v_aggregate jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select lower(role) into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'designer' then
    raise exception 'only designers may submit evaluations';
  end if;

  if p_commitment_confirmed is not true then
    raise exception 'commitment required';
  end if;

  if exists (
    select 1 from public.material_designer_evaluations
    where material_id = p_material_id and designer_id = v_uid
  ) then
    raise exception 'already rated';
  end if;

  if not exists (
    select 1 from public.materials
    where id::text = p_material_id
      and is_pending = false
      and status in ('published', '已发布')
  ) then
    raise exception 'material not found or not published';
  end if;

  v_adoption := p_project_adoption_id;
  if v_adoption is null then
    select id into v_adoption
    from public.material_project_adoptions
    where designer_id = v_uid
      and material_id::text = p_material_id
    order by
      case when status = 'approved' then 0 when status = 'pending_review' then 1 else 2 end,
      created_at desc
    limit 1;
  end if;

  v_project := nullif(trim(coalesce(p_project_name, '')), '');
  if v_project is null then
    select nullif(trim(i.project_name), '') into v_project
    from public.inquiries i
    where i.designer_id = v_uid
      and i.material_id::text = p_material_id
      and nullif(trim(i.project_name), '') is not null
    order by i.created_at desc
    limit 1;
  end if;
  if v_project is null and v_adoption is not null then
    v_project := public.material_display_name(p_material_id) || ' 项目案例';
  end if;
  if v_project is null then
    v_project := public.material_display_name(p_material_id);
  end if;

  insert into public.material_designer_evaluations (
    material_id, designer_id, evaluations, project_name, project_adoption_id,
    commitment_confirmed, status, updated_at
  )
  values (
    p_material_id::uuid, v_uid, p_evaluations, v_project, v_adoption,
    true, 'submitted', now()
  )
  returning id into v_eval_id;

  v_aggregate := public.recompute_material_evaluation_aggregate(p_material_id);

  select supplier_id into v_supplier from public.materials where id::text = p_material_id;
  v_target := coalesce(public.try_material_uuid(p_material_id), v_eval_id);

  if v_supplier is not null and v_supplier is distinct from v_uid then
    insert into public.notifications (receiver_id, sender_id, type, target_id, is_read)
    values (v_supplier, v_uid, 'evaluation_added', v_target, false);
  end if;

  perform public.log_material_event(
    p_material_id,
    'EVALUATE_X1',
    jsonb_build_object('evaluations', p_evaluations, 'aggregate', v_aggregate, 'project_name', v_project)
  );

  return v_aggregate || jsonb_build_object('evaluation_id', v_eval_id, 'project_name', v_project);
end;
$$;

grant execute on function public.submit_material_evaluation(text, jsonb, text, boolean, uuid) to authenticated;

-- ========== 5. 设计师更新评分 ==========
create or replace function public.update_material_evaluation(
  p_evaluation_id uuid,
  p_evaluations jsonb,
  p_commitment_confirmed boolean default false,
  p_project_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.material_designer_evaluations%rowtype;
  v_aggregate jsonb;
  v_project text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_commitment_confirmed is not true then
    raise exception 'commitment required';
  end if;

  select * into v_row
  from public.material_designer_evaluations
  where id = p_evaluation_id
  for update;

  if not found then
    raise exception 'evaluation not found';
  end if;
  if v_row.designer_id is distinct from v_uid then
    raise exception 'not your evaluation';
  end if;
  if v_row.status = 'revoked' then
    raise exception 'evaluation revoked';
  end if;

  v_project := coalesce(nullif(trim(p_project_name), ''), v_row.project_name);

  update public.material_designer_evaluations
  set evaluations = p_evaluations,
      project_name = v_project,
      commitment_confirmed = true,
      status = case when status = 'disputed' then 'submitted' else status end,
      disputed_at = case when status = 'disputed' then null else disputed_at end,
      updated_at = now()
  where id = p_evaluation_id;

  v_aggregate := public.recompute_material_evaluation_aggregate(v_row.material_id);

  perform public.log_material_event(
    v_row.material_id,
    'EVALUATE_X1',
    jsonb_build_object('evaluations', p_evaluations, 'aggregate', v_aggregate, 'updated', true)
  );

  return v_aggregate || jsonb_build_object('evaluation_id', p_evaluation_id, 'project_name', v_project);
end;
$$;

grant execute on function public.update_material_evaluation(uuid, jsonb, boolean, text) to authenticated;

-- ========== 6. 材料商复议 ==========
create or replace function public.dispute_material_evaluation(p_evaluation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_row public.material_designer_evaluations%rowtype;
  v_supplier uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select lower(role) into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'supplier' and v_role is distinct from 'admin' then
    raise exception 'only supplier or admin may dispute';
  end if;

  select * into v_row
  from public.material_designer_evaluations
  where id = p_evaluation_id
  for update;

  if not found then
    raise exception 'evaluation not found';
  end if;

  select supplier_id into v_supplier from public.materials where id::text = v_row.material_id;
  if v_role = 'supplier' and v_supplier is distinct from v_uid then
    raise exception 'not your material';
  end if;

  if v_row.status = 'revoked' then
    raise exception 'evaluation revoked';
  end if;

  update public.material_designer_evaluations
  set status = 'disputed',
      disputed_at = now(),
      disputed_by = v_uid,
      updated_at = now()
  where id = p_evaluation_id;

  perform public.notify_admins_evaluation_disputed(p_evaluation_id, v_uid);

  return jsonb_build_object('ok', true, 'status', 'disputed', 'evaluation_id', p_evaluation_id);
end;
$$;

grant execute on function public.dispute_material_evaluation(uuid) to authenticated;

-- ========== 7. 管理员改状态 ==========
create or replace function public.admin_set_evaluation_status(
  p_evaluation_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.material_designer_evaluations%rowtype;
  v_status text := lower(trim(p_status));
  v_aggregate jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if v_status not in ('submitted', 'disputed', 'revoked') then
    raise exception 'invalid status';
  end if;

  select * into v_row
  from public.material_designer_evaluations
  where id = p_evaluation_id
  for update;

  if not found then
    raise exception 'evaluation not found';
  end if;

  update public.material_designer_evaluations
  set status = v_status,
      disputed_at = case when v_status = 'disputed' then coalesce(disputed_at, now()) else disputed_at end,
      updated_at = now()
  where id = p_evaluation_id;

  v_aggregate := public.recompute_material_evaluation_aggregate(v_row.material_id);

  return jsonb_build_object('ok', true, 'status', v_status, 'aggregate', v_aggregate);
end;
$$;

grant execute on function public.admin_set_evaluation_status(uuid, text) to authenticated;
grant execute on function public.recompute_material_evaluation_aggregate(text) to authenticated;

-- ========== 8. 列表（含设计师账号/邮箱、材料商电话） ==========
create or replace function public.list_material_evaluations(p_material_id text default null)
returns table (
  id uuid,
  material_id text,
  designer_id uuid,
  designer_name text,
  designer_email text,
  designer_username text,
  project_name text,
  evaluations jsonb,
  status text,
  commitment_confirmed boolean,
  created_at timestamptz,
  updated_at timestamptz,
  disputed_at timestamptz,
  supplier_id uuid,
  supplier_phone text,
  material_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select lower(role) into v_role from public.profiles where id = v_uid;

  return query
  select
    e.id,
    e.material_id,
    e.designer_id,
    coalesce(nullif(trim(dp.company), ''), nullif(trim(dp.username), ''), dp.email, '设计师')::text,
    case when v_role = 'admin' then dp.email::text else ''::text end,
    case when v_role = 'admin' then dp.username::text else ''::text end,
    e.project_name,
    e.evaluations,
    e.status,
    e.commitment_confirmed,
    e.created_at,
    e.updated_at,
    e.disputed_at,
    m.supplier_id,
    case when v_role = 'admin' then coalesce(sp.registered_phone, '') else '' end::text,
    public.material_display_name(e.material_id::text)
  from public.material_designer_evaluations e
  join public.profiles dp on dp.id = e.designer_id
  left join public.materials m on m.id::text = e.material_id
  left join public.profiles sp on sp.id = m.supplier_id
  where (p_material_id is null or e.material_id = p_material_id)
    and (
      v_role = 'admin'
      or e.designer_id = v_uid
      or m.supplier_id = v_uid
    )
  order by
    case when e.status = 'disputed' then 0 else 1 end,
    e.updated_at desc;
end;
$$;

grant execute on function public.list_material_evaluations(text) to authenticated;

