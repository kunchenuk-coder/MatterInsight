-- 007: 规范化 public.user_assets，与前端 services/userAssetService.ts 字段严格对齐。
-- 幂等脚本：可在 Supabase SQL Editor 重复执行。
-- 关键修复：
--   1) 去掉手动建表时多加的 asset_url NOT NULL 约束（前端用 oss_object_key 作为唯一来源）。
--   2) 角色判断统一为小写 'admin'（与重构后的 profiles.role 对齐）。

create extension if not exists pgcrypto;

-- ========== 建表（全新环境） ==========
create table if not exists public.user_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_type text not null default 'image',
  oss_object_key text not null,
  content_type text,
  file_name text,
  category text,
  review_status text not null default 'pending_review',
  model_3d_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ========== 兼容已存在的表：补齐字段 ==========
alter table public.user_assets add column if not exists asset_type text;
alter table public.user_assets add column if not exists oss_object_key text;
alter table public.user_assets add column if not exists content_type text;
alter table public.user_assets add column if not exists file_name text;
alter table public.user_assets add column if not exists category text;
alter table public.user_assets add column if not exists review_status text;
alter table public.user_assets add column if not exists model_3d_url text;
alter table public.user_assets add column if not exists metadata jsonb;
alter table public.user_assets add column if not exists created_at timestamptz;
alter table public.user_assets add column if not exists updated_at timestamptz;

-- ========== 放宽 / 清理多余约束 ==========
-- 关键：手动建表遗留的 asset_url 不再强制非空（前端从不写它）。
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_assets' and column_name = 'asset_url'
  ) then
    execute 'alter table public.user_assets alter column asset_url drop not null';
  end if;
end $$;

-- ========== 默认值 ==========
alter table public.user_assets alter column asset_type set default 'image';
alter table public.user_assets alter column review_status set default 'pending_review';
alter table public.user_assets alter column metadata set default '{}'::jsonb;
alter table public.user_assets alter column created_at set default now();
alter table public.user_assets alter column updated_at set default now();

-- ========== 受控约束（先删后建，幂等） ==========
alter table public.user_assets drop constraint if exists user_assets_review_status_check;
alter table public.user_assets add constraint user_assets_review_status_check
  check (review_status in ('pending_review', 'approved', 'rejected'));

alter table public.user_assets drop constraint if exists user_assets_asset_type_check;
alter table public.user_assets add constraint user_assets_asset_type_check
  check (asset_type is null or asset_type in ('image', 'model_3d'));

-- ========== 索引 ==========
create index if not exists user_assets_user_id_idx on public.user_assets(user_id);
create index if not exists user_assets_review_status_idx on public.user_assets(review_status);
create index if not exists user_assets_asset_type_idx on public.user_assets(asset_type);

-- ========== updated_at 自动维护 ==========
create or replace function public.set_user_assets_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_assets_updated_at on public.user_assets;
create trigger trg_user_assets_updated_at
  before update on public.user_assets
  for each row execute function public.set_user_assets_updated_at();

-- ========== RLS ==========
alter table public.user_assets enable row level security;

-- 清理历史/手动创建的策略，统一重建
drop policy if exists "Allow public read assets" on public.user_assets;
drop policy if exists "Allow user insert own assets" on public.user_assets;
drop policy if exists "user_assets_own_all" on public.user_assets;
drop policy if exists "user_assets_admin_select" on public.user_assets;
drop policy if exists "user_assets_admin_update_review" on public.user_assets;
drop policy if exists "user_assets_select" on public.user_assets;
drop policy if exists "user_assets_insert" on public.user_assets;
drop policy if exists "user_assets_update" on public.user_assets;
drop policy if exists "user_assets_delete" on public.user_assets;

-- 读：本人可读自己的全部；审核通过的资产对所有人可见；管理员可读全部
create policy "user_assets_select" on public.user_assets
  for select using (
    auth.uid() = user_id
    or review_status = 'approved'
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and lower(p.role) = 'admin'
    )
  );

-- 写：只能插入属于自己的资产
create policy "user_assets_insert" on public.user_assets
  for insert with check (auth.uid() = user_id);

-- 改：本人或管理员
create policy "user_assets_update" on public.user_assets
  for update using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and lower(p.role) = 'admin'
    )
  );

-- 删：仅本人
create policy "user_assets_delete" on public.user_assets
  for delete using (auth.uid() = user_id);
