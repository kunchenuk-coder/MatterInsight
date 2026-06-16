-- Matter Insight 002：AI 审核队列 + 3D 资产字段（在 001 已执行基础上增量执行）
-- 请在 Supabase SQL Editor 中执行，不会覆盖 001 已有数据

-- ========== local_materials 扩展 ==========
alter table public.local_materials
  add column if not exists review_status text not null default 'pending_review'
    check (review_status in ('pending_review', 'approved', 'rejected'));

alter table public.local_materials
  add column if not exists model_3d_url text;

alter table public.local_materials
  add column if not exists oss_object_key text;

create index if not exists local_materials_review_status_idx
  on public.local_materials (review_status);

-- ========== materials 扩展 ==========
alter table public.materials
  add column if not exists review_status text not null default 'pending_review'
    check (review_status in ('pending_review', 'approved', 'rejected'));

alter table public.materials
  add column if not exists model_3d_url text;

alter table public.materials
  add column if not exists oss_object_key text;

create index if not exists materials_review_status_idx
  on public.materials (review_status);

-- ========== user_assets（统一资产表，供 AI 审核队列与未来 VR 扩展） ==========
create table if not exists public.user_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  asset_type text not null default 'image'
    check (asset_type in ('image', 'model_3d')),
  oss_object_key text not null,
  content_type text,
  file_name text,
  category text,
  review_status text not null default 'pending_review'
    check (review_status in ('pending_review', 'approved', 'rejected')),
  model_3d_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_assets_user_id_idx on public.user_assets(user_id);
create index if not exists user_assets_review_status_idx on public.user_assets(review_status);
create index if not exists user_assets_asset_type_idx on public.user_assets(asset_type);

alter table public.user_assets enable row level security;

create policy "user_assets_own_all"
  on public.user_assets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 管理员可读全部资产（供未来人工/AI 审核后台）
create policy "user_assets_admin_select"
  on public.user_assets for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'ADMIN'
    )
  );

create policy "user_assets_admin_update_review"
  on public.user_assets for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'ADMIN'
    )
  );
