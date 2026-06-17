-- 008: 为 profiles 补齐材料商入驻/审核所需字段，并补充管理员审核 RLS。
-- 幂等脚本，可重复执行。
-- 修复：
--   1) updateVerificationRequest 写 registered_phone / verification_doc_url 失败（字段缺失）。
--   2) approveSupplier 写 status / is_verified 失败（字段缺失 + 无管理员 update 策略）。

-- ========== 补齐字段 ==========
alter table public.profiles add column if not exists registered_phone text;
alter table public.profiles add column if not exists verification_doc_url text;
alter table public.profiles add column if not exists status text;
alter table public.profiles add column if not exists is_verified boolean;

-- ========== 回填历史数据 ==========
-- 非材料商默认视为已验证；材料商需走认证流程，默认未验证。
update public.profiles set is_verified = true  where is_verified is null and lower(role) <> 'supplier';
update public.profiles set is_verified = false where is_verified is null and lower(role) =  'supplier';
-- status 默认 approved（账号可用），避免材料商被"账号审核中"挡在认证表单之前。
update public.profiles set status = 'approved' where status is null;

-- ========== 默认值 ==========
alter table public.profiles alter column is_verified set default false;
alter table public.profiles alter column status set default 'approved';

-- ========== 管理员判定函数（SECURITY DEFINER，绕过 RLS 防止递归） ==========
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and lower(role) = 'admin'
  );
$$;

-- ========== 管理员审核策略 ==========
-- 让管理员可读/改任意 profile（用于审核材料商）。本人读改策略已存在，保留。
drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update" on public.profiles
  for update using (public.is_admin()) with check (true);
