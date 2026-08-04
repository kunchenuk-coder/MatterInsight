-- ############################################################################
-- Admin 后台数据基础：材料统计字段 + 积分 + 交易流水 + 供应商评估 RPC
-- ############################################################################

-- 1) materials 统计字段
alter table public.materials
  add column if not exists favorite_count integer not null default 0;

alter table public.materials
  add column if not exists quote_count integer not null default 0;

comment on column public.materials.favorite_count is '收藏次数（saved_materials 触发器维护）';
comment on column public.materials.quote_count is '询价/报价次数（increment_material_quote_count 维护）';

-- 回填收藏数
update public.materials m
set favorite_count = coalesce(s.cnt, 0)
from (
  select material_id, count(*)::integer as cnt
  from public.saved_materials
  group by material_id
) s
where m.id = s.material_id
  and m.favorite_count is distinct from s.cnt;

-- 兼容旧 JSON saves / 估算报价字段
update public.materials
set favorite_count = greatest(
  favorite_count,
  coalesce(nullif(data->>'saves', '')::integer, 0)
)
where coalesce(nullif(data->>'saves', '')::integer, 0) > favorite_count;

-- 2) profiles 积分字段（current_points = 剩余；consumed_points = 已消费）
alter table public.profiles
  add column if not exists current_points integer;

alter table public.profiles
  add column if not exists consumed_points integer not null default 0;

update public.profiles
set current_points = coalesce(current_points, points, 0)
where current_points is null;

alter table public.profiles
  alter column current_points set default 0;

alter table public.profiles
  alter column current_points set not null;

comment on column public.profiles.current_points is '剩余积分（与 points 对齐）';
comment on column public.profiles.consumed_points is '累计已消费积分';

-- 双向同步：更新 current_points 时写回 points；更新 points 时写回 current_points
create or replace function public.trg_profiles_sync_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.current_points := coalesce(new.current_points, new.points, 0);
    new.points := coalesce(new.points, new.current_points, 0);
    new.consumed_points := coalesce(new.consumed_points, 0);
    return new;
  end if;

  if new.current_points is distinct from old.current_points
     and new.points is not distinct from old.points then
    new.points := new.current_points;
  elsif new.points is distinct from old.points
     and new.current_points is not distinct from old.current_points then
    new.current_points := new.points;
  else
    -- 两者都变：以 current_points 为准；若仅 points 有值则对齐
    new.current_points := coalesce(new.current_points, new.points, 0);
    new.points := new.current_points;
  end if;

  new.consumed_points := coalesce(new.consumed_points, 0);
  return new;
end;
$$;

drop trigger if exists profiles_sync_points on public.profiles;
create trigger profiles_sync_points
  before insert or update of points, current_points, consumed_points
  on public.profiles
  for each row execute function public.trg_profiles_sync_points();

-- 3) 积分流水（可按供应商归因）
create table if not exists public.points_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  related_supplier_id uuid references public.profiles(id) on delete set null,
  related_material_id uuid references public.materials(id) on delete set null,
  transaction_type text not null
    check (transaction_type in ('recharge', 'consume', 'gift', 'refund', 'admin_adjust')),
  amount integer not null,
  balance_after integer,
  description text,
  payment_amount numeric(12, 2),
  payment_currency text not null default 'CNY',
  created_at timestamptz not null default now()
);

create index if not exists points_transactions_user_idx
  on public.points_transactions (user_id, created_at desc);

create index if not exists points_transactions_supplier_idx
  on public.points_transactions (related_supplier_id, transaction_type)
  where related_supplier_id is not null;

alter table public.points_transactions enable row level security;

drop policy if exists "points_transactions_select" on public.points_transactions;
create policy "points_transactions_select"
  on public.points_transactions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "points_transactions_insert" on public.points_transactions;
create policy "points_transactions_insert"
  on public.points_transactions for insert to authenticated
  with check (user_id = auth.uid() or public.is_admin());

-- 4) 交易/订单表（供应商 GMV）
create table if not exists public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.profiles(id) on delete cascade,
  designer_id uuid references public.profiles(id) on delete set null,
  material_id uuid references public.materials(id) on delete set null,
  order_type text not null default 'other'
    check (order_type in ('sample', 'quote', 'purchase', 'recharge', 'other')),
  amount_cny numeric(12, 2) not null default 0,
  points_spent integer not null default 0,
  status text not null default 'completed'
    check (status in ('pending', 'completed', 'cancelled', 'refunded')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commerce_orders_supplier_idx
  on public.commerce_orders (supplier_id, status, created_at desc);

create index if not exists commerce_orders_material_idx
  on public.commerce_orders (material_id)
  where material_id is not null;

alter table public.commerce_orders enable row level security;

drop policy if exists "commerce_orders_select" on public.commerce_orders;
create policy "commerce_orders_select"
  on public.commerce_orders for select to authenticated
  using (
    designer_id = auth.uid()
    or supplier_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists "commerce_orders_insert" on public.commerce_orders;
create policy "commerce_orders_insert"
  on public.commerce_orders for insert to authenticated
  with check (
    designer_id = auth.uid()
    or supplier_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists "commerce_orders_admin_update" on public.commerce_orders;
create policy "commerce_orders_admin_update"
  on public.commerce_orders for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 5) 收藏数触发器（saved_materials → materials.favorite_count）
create or replace function public.trg_saved_materials_favorite_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.materials
    set
      favorite_count = coalesce(favorite_count, 0) + 1,
      data = coalesce(data, '{}'::jsonb)
        || jsonb_build_object('saves', coalesce(favorite_count, 0) + 1),
      updated_at = now()
    where id = new.material_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.materials
    set
      favorite_count = greatest(coalesce(favorite_count, 0) - 1, 0),
      data = coalesce(data, '{}'::jsonb)
        || jsonb_build_object('saves', greatest(coalesce(favorite_count, 0) - 1, 0)),
      updated_at = now()
    where id = old.material_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists saved_materials_favorite_count on public.saved_materials;
create trigger saved_materials_favorite_count
  after insert or delete on public.saved_materials
  for each row execute function public.trg_saved_materials_favorite_count();

-- 6) 询价次数 +1 RPC
create or replace function public.increment_material_quote_count(p_material_id uuid)
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
    quote_count = coalesce(quote_count, 0) + 1,
    updated_at = now()
  where id = p_material_id
  returning quote_count into v_count;

  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.increment_material_quote_count(uuid) to authenticated;

-- 7) 记录消费积分 + 可选写入订单（小样等）
create or replace function public.record_points_consume(
  p_amount integer,
  p_description text default null,
  p_related_supplier_id uuid default null,
  p_related_material_id uuid default null,
  p_order_type text default null,
  p_amount_cny numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_balance integer;
  v_tx_id uuid;
  v_order_id uuid;
  v_order_type text := nullif(trim(coalesce(p_order_type, '')), '');
  v_before integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  select coalesce(current_points, points, 0)
  into v_before
  from public.profiles
  where id = v_uid
  for update;

  if v_before is null then
    raise exception 'profile not found';
  end if;

  v_balance := greatest(v_before - p_amount, 0);

  update public.profiles
  set
    current_points = v_balance,
    points = v_balance,
    consumed_points = coalesce(consumed_points, 0) + p_amount,
    updated_at = now()
  where id = v_uid;

  insert into public.points_transactions (
    user_id, related_supplier_id, related_material_id,
    transaction_type, amount, balance_after, description
  )
  values (
    v_uid, p_related_supplier_id, p_related_material_id,
    'consume', p_amount, v_balance, p_description
  )
  returning id into v_tx_id;

  if v_order_type is not null and p_related_supplier_id is not null then
    if v_order_type not in ('sample', 'quote', 'purchase', 'recharge', 'other') then
      v_order_type := 'other';
    end if;
    insert into public.commerce_orders (
      supplier_id, designer_id, material_id,
      order_type, amount_cny, points_spent, status, note
    )
    values (
      p_related_supplier_id, v_uid, p_related_material_id,
      v_order_type, coalesce(p_amount_cny, 0), p_amount, 'completed', p_description
    )
    returning id into v_order_id;
  end if;

  return jsonb_build_object(
    'transaction_id', v_tx_id,
    'order_id', v_order_id,
    'balance_after', v_balance
  );
end;
$$;

grant execute on function public.record_points_consume(integer, text, uuid, uuid, text, numeric) to authenticated;

-- 8) 供应商评估聚合 RPC（Admin）
create or replace function public.admin_supplier_evaluations()
returns table (
  supplier_id uuid,
  supplier_name text,
  supplier_email text,
  published_count bigint,
  points_consumed bigint,
  gmv_cny numeric,
  risk_level text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'admin only';
  end if;

  return query
  with published as (
    select
      m.supplier_id as sid,
      count(*)::bigint as cnt
    from public.materials m
    where m.is_pending = false
      and m.status in ('已发布', 'published')
    group by m.supplier_id
  ),
  pts as (
    select
      t.related_supplier_id as sid,
      coalesce(sum(t.amount), 0)::bigint as consumed
    from public.points_transactions t
    where t.transaction_type = 'consume'
      and t.related_supplier_id is not null
    group by t.related_supplier_id
  ),
  gmv as (
    select
      o.supplier_id as sid,
      coalesce(sum(o.amount_cny), 0)::numeric as total
    from public.commerce_orders o
    where o.status = 'completed'
    group by o.supplier_id
  )
  select
    p.id,
    coalesce(nullif(p.company, ''), nullif(p.username, ''), split_part(p.email, '@', 1)),
    p.email,
    coalesce(pub.cnt, 0),
    coalesce(pts.consumed, 0),
    coalesce(gmv.total, 0),
    case
      when coalesce(pub.cnt, 0) >= 3 and coalesce(gmv.total, 0) = 0 and coalesce(pts.consumed, 0) = 0
        then 'Suspicious'
      else 'Low'
    end
  from public.profiles p
  left join published pub on pub.sid = p.id
  left join pts on pts.sid = p.id
  left join gmv on gmv.sid = p.id
  where lower(p.role) = 'supplier'
  order by coalesce(pub.cnt, 0) desc, p.created_at desc;
end;
$$;

grant execute on function public.admin_supplier_evaluations() to authenticated;
