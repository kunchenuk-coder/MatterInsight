-- =============================================================================
-- Matter Insight — profiles 表 RLS 完整修复脚本
-- 在 Supabase Dashboard → SQL Editor 中整段粘贴并 Run
--
-- 修复问题：
--   • infinite recursion detected in policy for relation "profiles"
--   • 登录后无法 SELECT 自己的 profile 行
--
-- 说明：
--   • 本项目的 role 使用大写枚举：DESIGNER | SUPPLIER | ADMIN（与前端 types.ts 一致）
--   • 默认角色为 DESIGNER（非小写 designer）
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. 补全表结构（若已存在则跳过）
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'DESIGNER'
    check (role in ('DESIGNER', 'SUPPLIER', 'ADMIN')),
  name text,
  company text,
  points integer not null default 0,
  status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected')),
  is_verified boolean not null default false,
  registered_phone text,
  verification_doc_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- role：若列已存在但无默认值，补上默认 DESIGNER
alter table public.profiles
  alter column role set default 'DESIGNER';

-- organization_id：可选扩展字段（前端暂未使用，先 nullable）
alter table public.profiles
  add column if not exists organization_id uuid;

comment on column public.profiles.role is 'DESIGNER | SUPPLIER | ADMIN';
comment on column public.profiles.organization_id is '可选组织 ID，预留扩展';

-- ---------------------------------------------------------------------------
-- 2. 启用 RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- 3. 移除所有旧策略（含曾导致递归的 admin 子查询策略）
-- ---------------------------------------------------------------------------
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
  loop
    execute format('drop policy if exists %I on public.profiles', pol.policyname);
    raise notice 'Dropped policy: %', pol.policyname;
  end loop;
end $$;

-- 显式删除可能存在的旧名称（双保险）
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_admin_select_all" on public.profiles;
drop policy if exists "profiles_admin_update_all" on public.profiles;
drop policy if exists "fix_profiles_rls_recursion" on public.profiles;
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;

-- ---------------------------------------------------------------------------
-- 4. 管理员判断函数（SECURITY DEFINER，避免策略内再查 profiles 引发递归）
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'ADMIN'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_admin() to anon;

-- ---------------------------------------------------------------------------
-- 5. 重新创建正确策略
-- ---------------------------------------------------------------------------

-- 5a. 用户读取自己的行
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- 5b. 管理员读取全部（通过 is_admin()，不递归）
create policy "profiles_admin_select_all"
  on public.profiles
  for select
  to authenticated
  using (public.is_admin());

-- 5c. 新用户注册 / 客户端 upsert 时插入自己的行
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

-- 5d. 用户更新自己的行
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 5e. 管理员更新任意行（运营审核供应商等）
create policy "profiles_admin_update_all"
  on public.profiles
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 6. 表级权限（authenticated 角色可访问）
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Auth 注册后自动写入 profile（Trigger，SECURITY DEFINER 绕过 RLS 插入）
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    role,
    name,
    status,
    is_verified,
    points
  )
  values (
    new.id,
    coalesce(new.email, ''),
    'DESIGNER',
    split_part(coalesce(new.email, 'user'), '@', 1),
    'approved',
    true,
    0
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 8. 为已登录但尚无 profile 行的 auth 用户补数据（可选，执行一次即可）
-- ---------------------------------------------------------------------------
insert into public.profiles (id, email, role, name, status, is_verified, points)
select
  u.id,
  coalesce(u.email, ''),
  'DESIGNER',
  split_part(coalesce(u.email, 'user'), '@', 1),
  'approved',
  true,
  0
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

commit;

-- ---------------------------------------------------------------------------
-- 9. 验证（运行后应在 Results 看到自己的 id / email / role）
-- ---------------------------------------------------------------------------
-- select id, email, role, status from public.profiles where id = auth.uid();
