-- =============================================================================
-- Matter Insight 005 — profiles「一号多角」平滑迁移（保留 id 列，不 DROP COLUMN）
--
-- 在 Supabase Dashboard → SQL Editor 中整段执行。
--
-- 修复上一版报错根因：
--   RLS 策略（profiles_*、materials_admin_all）的表达式依赖 profiles.id 列，
--   PostgreSQL 禁止在仍有策略依赖时 DROP COLUMN id。
--
-- 本脚本原则：
--   1. 先删除所有依赖旧字段的策略，再改表结构
--   2. 绝不 DROP COLUMN id
--   3. 新增 user_id，从旧 id（auth uid）回填
--   4. 去掉 id→auth.users 外键与主键后，将 id 原地更新为身份行 UUID（auth uid 保留在 user_id）
--   5. UNIQUE(user_id, role) 支持一号多角
--   6. 全新 RLS 基于 user_id
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. 诊断：打印当前列
-- ---------------------------------------------------------------------------
do $$
declare
  col_list text;
begin
  select string_agg(column_name || ' (' || data_type || ')', ', ' order by ordinal_position)
  into col_list
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles';

  raise notice '【诊断】profiles 当前列: %', coalesce(col_list, '(表不存在)');
end $$;

-- ---------------------------------------------------------------------------
-- 1. 先清理 RLS 策略（必须在改列之前！解除对 profiles.id 的依赖）
-- ---------------------------------------------------------------------------

-- 1a. profiles 表全部策略
do $$
declare pol record;
begin
  if to_regclass('public.profiles') is null then return; end if;
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format('drop policy if exists %I on public.profiles', pol.policyname);
    raise notice '【RLS】已删除 profiles.%', pol.policyname;
  end loop;
end $$;

-- 1b. materials 中依赖 profiles 子查询的策略
do $$
begin
  if to_regclass('public.materials') is null then return; end if;
  drop policy if exists "materials_admin_all" on public.materials;
  raise notice '【RLS】已删除 materials.materials_admin_all';
end $$;

-- 1c. user_assets 中依赖 profiles 子查询的策略
do $$
begin
  if to_regclass('public.user_assets') is null then return; end if;
  drop policy if exists "user_assets_admin_select" on public.user_assets;
  drop policy if exists "user_assets_admin_update_review" on public.user_assets;
  raise notice '【RLS】已删除 user_assets admin 策略';
end $$;

-- ---------------------------------------------------------------------------
-- 2. 解除子表对 profiles(id) 的外键（子表 user_id 语义为 auth uid）
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  if to_regclass('public.profiles') is null then return; end if;
  for r in
    select src_ns.nspname as src_schema, src.relname as src_table, con.conname
    from pg_constraint con
    join pg_class src on src.oid = con.conrelid
    join pg_namespace src_ns on src_ns.oid = src.relnamespace
    join pg_class tgt on tgt.oid = con.confrelid
    join pg_namespace tgt_ns on tgt_ns.oid = tgt.relnamespace
    where con.contype = 'f'
      and tgt_ns.nspname = 'public' and tgt.relname = 'profiles'
  loop
    execute format('alter table %I.%I drop constraint if exists %I', r.src_schema, r.src_table, r.conname);
    raise notice '【FK】已解除 %.%', r.src_table, r.conname;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. 确保 profiles 基础表存在
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
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

alter table public.profiles
  add column if not exists organization_id uuid;

alter table public.profiles
  alter column role set default 'DESIGNER';

-- ---------------------------------------------------------------------------
-- 4. 安全添加 user_id，并从旧 id 回填（仅 user_id 为空时）
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists user_id uuid;

-- 仅当 id 仍等于 auth uid（尚未迁移为行 UUID）时，把 id 复制到 user_id
update public.profiles
set user_id = id
where user_id is null;

-- ---------------------------------------------------------------------------
-- 5. 清理上次失败迁移留下的临时列 profile_row_id（可安全删除，非核心业务列）
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'profile_row_id'
  ) then
    -- 若 id 仍为 auth uid，先把预生成的 UUID 写回 id（不删 id 列）
    update public.profiles
    set id = profile_row_id
    where profile_row_id is not null
      and user_id is not null
      and id = user_id;

    alter table public.profiles drop column profile_row_id;
    raise notice '【清理】已合并 profile_row_id 并删除临时列';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. 将 id 从「auth uid」原地转为「身份行 UUID」（不 DROP COLUMN）
-- ---------------------------------------------------------------------------
do $$
declare
  id_refs_auth boolean;
  needs_id_swap boolean;
begin
  -- id 是否仍外键指向 auth.users
  select exists (
    select 1
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    join pg_attribute att on att.attrelid = c.conrelid
      and att.attnum = any (c.conkey) and array_length(c.conkey, 1) = 1
    join pg_class tgt on tgt.oid = c.confrelid
    join pg_namespace tgt_nsp on tgt_nsp.oid = tgt.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'profiles'
      and c.contype = 'f' and att.attname = 'id'
      and tgt_nsp.nspname = 'auth' and tgt.relname = 'users'
  ) into id_refs_auth;

  -- 或：仍有行的 id = user_id（说明 id 还没换成行 UUID）
  select exists (
    select 1 from public.profiles
    where user_id is not null and id = user_id
  ) into needs_id_swap;

  if not id_refs_auth and not needs_id_swap then
    raise notice '【结构】id 已是身份行 UUID，跳过 id 原地转换';
    return;
  end if;

  raise notice '【结构】开始将 id 从 auth uid 转换为身份行 UUID（保留列，仅 UPDATE）…';

  -- 去掉主键与外键约束（不删列）
  alter table public.profiles drop constraint if exists profiles_pkey;
  alter table public.profiles drop constraint if exists profiles_id_fkey;

  -- 原地更新：auth uid 已保存在 user_id，id 换成新 UUID
  update public.profiles
  set id = gen_random_uuid()
  where user_id is not null and id = user_id;

  alter table public.profiles alter column id set default gen_random_uuid();
  alter table public.profiles alter column id set not null;

  -- 重建主键（id 列仍在，只是值变了）
  alter table public.profiles add primary key (id);

  raise notice '【结构】id 列已转换为身份行主键';
end $$;

-- ---------------------------------------------------------------------------
-- 7. user_id 约束：NOT NULL + FK + UNIQUE(user_id, role)
-- ---------------------------------------------------------------------------
update public.profiles set user_id = id where user_id is null and id is not null;

alter table public.profiles alter column user_id set not null;

alter table public.profiles drop constraint if exists profiles_user_id_fkey;
alter table public.profiles
  add constraint profiles_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- 去重检查后创建唯一索引
do $$
begin
  if exists (
    select user_id, role, count(*) as cnt
    from public.profiles
    group by user_id, role
    having count(*) > 1
  ) then
    raise exception '存在重复的 (user_id, role)，请先手工去重后再执行';
  end if;
end $$;

create unique index if not exists profiles_user_id_role_key
  on public.profiles (user_id, role);

create index if not exists profiles_user_id_idx on public.profiles (user_id);
create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_status_idx on public.profiles (status);

comment on table public.profiles is '用户身份表：一个 auth 用户可有多条身份（按 role 区分）';
comment on column public.profiles.id is '身份行主键 UUID（非 auth uid）';
comment on column public.profiles.user_id is 'auth.users.id，同一用户可有多行';

-- ---------------------------------------------------------------------------
-- 8. 角色默认审核状态（INSERT 时）
-- ---------------------------------------------------------------------------
create or replace function public.profiles_apply_role_defaults()
returns trigger language plpgsql as $$
begin
  if new.role = 'DESIGNER' then
    if new.status is null then new.status := 'approved'; end if;
    if new.is_verified is null then new.is_verified := true; end if;
  elsif new.role = 'SUPPLIER' then
    if new.status is null then new.status := 'pending'; end if;
    if new.is_verified is null then new.is_verified := false; end if;
  elsif new.role = 'ADMIN' then
    if new.status is null then new.status := 'approved'; end if;
    if new.is_verified is null then new.is_verified := true; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_role_defaults on public.profiles;
create trigger profiles_role_defaults
  before insert on public.profiles
  for each row execute function public.profiles_apply_role_defaults();

-- ---------------------------------------------------------------------------
-- 9. is_admin() — 基于 user_id（在 user_id 列就绪后创建）
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid()
      and role = 'ADMIN'
      and status = 'approved'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_admin() to anon;

-- ---------------------------------------------------------------------------
-- 10. 全新 RLS（全部基于 user_id，不再引用 id = auth.uid()）
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (auth.uid() = user_id);

create policy "profiles_admin_select_all"
  on public.profiles for select to authenticated
  using (public.is_admin());

create policy "profiles_insert_own"
  on public.profiles for insert to authenticated
  with check (auth.uid() = user_id);

create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "profiles_admin_update_all"
  on public.profiles for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Auth 注册触发器（写入 user_id；id 由 default 自动生成）
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, role, name, status, is_verified, points)
  values (
    new.id,
    coalesce(new.email, ''),
    'DESIGNER',
    split_part(coalesce(new.email, 'user'), '@', 1),
    'approved',
    true,
    0
  )
  on conflict (user_id, role) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 12. 子表外键改指向 auth.users
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.moodboards') is not null then
    alter table public.moodboards drop constraint if exists moodboards_user_id_fkey;
    alter table public.moodboards
      add constraint moodboards_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
  if to_regclass('public.local_materials') is not null then
    alter table public.local_materials drop constraint if exists local_materials_user_id_fkey;
    alter table public.local_materials
      add constraint local_materials_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
  if to_regclass('public.saved_materials') is not null then
    alter table public.saved_materials drop constraint if exists saved_materials_user_id_fkey;
    alter table public.saved_materials
      add constraint saved_materials_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
  if to_regclass('public.materials') is not null then
    alter table public.materials drop constraint if exists materials_user_id_fkey;
    alter table public.materials
      add constraint materials_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
    alter table public.materials drop constraint if exists materials_supplier_id_fkey;
    alter table public.materials
      add constraint materials_supplier_id_fkey
      foreign key (supplier_id) references auth.users(id) on delete cascade;

    -- 恢复 materials 其它策略（非 admin 的保持不变；admin 用 is_admin）
    drop policy if exists "materials_admin_all" on public.materials;
    create policy "materials_admin_all"
      on public.materials for all to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;
  if to_regclass('public.user_assets') is not null then
    alter table public.user_assets drop constraint if exists user_assets_user_id_fkey;
    alter table public.user_assets
      add constraint user_assets_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;

    create policy "user_assets_admin_select"
      on public.user_assets for select to authenticated
      using (public.is_admin());
    create policy "user_assets_admin_update_review"
      on public.user_assets for update to authenticated
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 13. 为没有任何 profile 的 auth 用户补 DESIGNER 身份
-- ---------------------------------------------------------------------------
insert into public.profiles (user_id, email, role, name, status, is_verified, points)
select
  u.id,
  coalesce(u.email, ''),
  'DESIGNER',
  split_part(coalesce(u.email, 'user'), '@', 1),
  'approved',
  true,
  0
from auth.users u
where not exists (select 1 from public.profiles p where p.user_id = u.id)
on conflict (user_id, role) do nothing;

commit;

-- =============================================================================
-- 14. 执行成功后请单独运行以下验证（不要与上面混在一次 Run 里若 Editor 报错）
-- =============================================================================
--
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'profiles'
-- order by ordinal_position;
--
-- select id, user_id, email, role, status,
--        (id = user_id) as id_still_auth_uid  -- 应为 false
-- from public.profiles
-- limit 20;
--
-- 测试添加第二个身份（材料商）：
-- insert into public.profiles (user_id, email, role, name, company)
-- values (
--   '<your-auth-users-uuid>',
--   'you@example.com',
--   'SUPPLIER',
--   '测试供应商',
--   'Premium Materials Co.'
-- )
-- on conflict (user_id, role) do nothing;
