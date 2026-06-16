-- Matter Insight 初始数据库结构
-- 在 Supabase SQL Editor 中执行此脚本，或使用 supabase db push

-- ========== profiles（用户资料，绑定 auth.users） ==========
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('DESIGNER', 'SUPPLIER', 'ADMIN')),
  name text,
  company text,
  points integer not null default 0,
  status text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  is_verified boolean not null default false,
  registered_phone text,
  verification_doc_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 用户只能读取自己的资料
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

-- 用户只能更新自己的资料（不含 status/is_verified 的敏感字段由 trigger 保护）
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- 注册时插入自己的 profile
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

-- 管理员可读全部（需在 profiles 中存在 role=ADMIN 的用户）
create policy "profiles_admin_select_all"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'ADMIN'
    )
  );

create policy "profiles_admin_update_all"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'ADMIN'
    )
  );

-- ========== moodboards（设计师情绪板） ==========
create table if not exists public.moodboards (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  items jsonb not null default '[]'::jsonb,
  is_paid boolean not null default false,
  max_materials integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists moodboards_user_id_idx on public.moodboards(user_id);

alter table public.moodboards enable row level security;

create policy "moodboards_own_all"
  on public.moodboards for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ========== local_materials（设计师本地材料） ==========
create table if not exists public.local_materials (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default '自定义材质',
  spec text not null default '标准',
  image_url text not null,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index if not exists local_materials_user_id_idx on public.local_materials(user_id);

alter table public.local_materials enable row level security;

create policy "local_materials_own_all"
  on public.local_materials for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ========== saved_materials（设计师收藏） ==========
create table if not exists public.saved_materials (
  user_id uuid not null references public.profiles(id) on delete cascade,
  material_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, material_id)
);

alter table public.saved_materials enable row level security;

create policy "saved_materials_own_all"
  on public.saved_materials for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ========== materials（材料库 + 待审核，JSON 存完整结构） ==========
create table if not exists public.materials (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  supplier_id uuid not null references public.profiles(id) on delete cascade,
  data jsonb not null,
  status text not null default '待审核',
  is_pending boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists materials_supplier_id_idx on public.materials(supplier_id);
create index if not exists materials_is_pending_idx on public.materials(is_pending);

alter table public.materials enable row level security;

-- 所有人可读已发布材料
create policy "materials_select_published"
  on public.materials for select
  using (is_pending = false and status = '已发布');

-- 供应商可读写自己的材料
create policy "materials_supplier_own"
  on public.materials for all
  using (auth.uid() = supplier_id)
  with check (auth.uid() = supplier_id);

-- 管理员可读写全部
create policy "materials_admin_all"
  on public.materials for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'ADMIN'
    )
  );

-- ========== 注册后自动创建 profile 的触发器（可选，客户端 upsert 亦可） ==========
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, role, name, status, is_verified)
  values (
    new.id,
    new.email,
    'DESIGNER',
    split_part(new.email, '@', 1),
    'approved',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
