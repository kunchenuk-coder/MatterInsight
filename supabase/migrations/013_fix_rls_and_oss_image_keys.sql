-- Matter Insight 013：修复 moodboards RLS 死循环 + 补全 OSS 字段 + 历史材料 key 刷洗
-- 已在 Supabase 远程执行；本地仓库保留副本便于同步

-- ========== 1. 表结构 ==========
alter table public.local_materials
  add column if not exists oss_object_key text;

alter table public.local_materials
  add column if not exists asset_url text;

alter table public.materials
  add column if not exists oss_object_key text;

-- ========== 2. moodboards RLS（消除与 collaborators 的互相嵌套） ==========
create or replace function public.moodboard_owner_id(p_board_id text)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select m.user_id
  from public.moodboards m
  where m.id = p_board_id
  limit 1;
$$;

create or replace function public.is_moodboard_collaborator(p_board_id text, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.moodboard_collaborators c
    where c.moodboard_id = p_board_id
      and c.user_id = p_user_id
  );
$$;

revoke all on function public.moodboard_owner_id(text) from public;
revoke all on function public.is_moodboard_collaborator(text, uuid) from public;

grant execute on function public.moodboard_owner_id(text) to anon, authenticated;
grant execute on function public.is_moodboard_collaborator(text, uuid) to anon, authenticated;

drop policy if exists "moodboards_select" on public.moodboards;
drop policy if exists "moodboards_insert_own" on public.moodboards;
drop policy if exists "moodboards_update_own" on public.moodboards;
drop policy if exists "moodboards_delete_own" on public.moodboards;
drop policy if exists "moodboards_own_all" on public.moodboards;

drop policy if exists "moodboard_collaborators_select" on public.moodboard_collaborators;
drop policy if exists "moodboard_collaborators_insert_owner" on public.moodboard_collaborators;
drop policy if exists "moodboard_collaborators_delete_owner" on public.moodboard_collaborators;

create policy "moodboards_select"
  on public.moodboards
  for select
  using (
    visibility = 'public'
    or (auth.uid() is not null and auth.uid() = user_id)
    or (
      auth.uid() is not null
      and visibility = 'team'
      and public.is_moodboard_collaborator(id, auth.uid())
    )
  );

create policy "moodboards_insert_own"
  on public.moodboards
  for insert
  with check (auth.uid() = user_id);

create policy "moodboards_update_own"
  on public.moodboards
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "moodboards_delete_own"
  on public.moodboards
  for delete
  using (auth.uid() = user_id);

create policy "moodboard_collaborators_select"
  on public.moodboard_collaborators
  for select
  using (
    user_id = auth.uid()
    or public.moodboard_owner_id(moodboard_id) = auth.uid()
  );

create policy "moodboard_collaborators_insert_owner"
  on public.moodboard_collaborators
  for insert
  with check (
    invited_by = auth.uid()
    and public.moodboard_owner_id(moodboard_id) = auth.uid()
  );

create policy "moodboard_collaborators_delete_owner"
  on public.moodboard_collaborators
  for delete
  using (
    public.moodboard_owner_id(moodboard_id) = auth.uid()
  );

-- ========== 3. 历史数据：从过期 image URL 提取 oss_object_key ==========
update public.materials m
set oss_object_key = coalesce(
  nullif(m.oss_object_key, ''),
  substring(m.data->>'image' from 'users/[^?#]+')
)
where m.data->>'image' like '%aliyuncs.com%'
  and coalesce(m.oss_object_key, '') = '';

update public.materials m
set data = jsonb_set(
  coalesce(m.data, '{}'::jsonb),
  '{ossObjectKey}',
  to_jsonb(m.oss_object_key),
  true
)
where coalesce(m.oss_object_key, '') <> ''
  and (m.data->>'ossObjectKey' is null or m.data->>'ossObjectKey' = '');

update public.local_materials lm
set oss_object_key = coalesce(
  nullif(lm.oss_object_key, ''),
  substring(lm.image_url from 'users/[^?#]+')
)
where lm.image_url like '%aliyuncs.com%'
  and coalesce(lm.oss_object_key, '') = '';
