-- 平台材料买手：无限点数（展示 9999）+ 材料商资产类型扩展

alter table public.profiles
  add column if not exists is_unlimited_points boolean not null default false;

comment on column public.profiles.is_unlimited_points is
  'true 时 record_points_consume 不扣减余额，前端展示 9999';

alter table public.user_assets drop constraint if exists user_assets_asset_type_check;
alter table public.user_assets add constraint user_assets_asset_type_check
  check (asset_type is null or asset_type in ('image', 'model_3d', 'document', 'video'));

update public.profiles
set
  is_unlimited_points = true,
  points = 9999,
  current_points = 9999,
  updated_at = now()
where lower(email) = lower('13701344071@163.com');

create or replace function public.trg_platform_buyer_unlimited_points()
returns trigger
language plpgsql
as $$
begin
  if lower(coalesce(new.email, '')) = '13701344071@163.com' then
    new.is_unlimited_points := true;
    new.points := 9999;
    new.current_points := 9999;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_platform_buyer_unlimited_points on public.profiles;
create trigger profiles_platform_buyer_unlimited_points
  before insert or update of email, points, current_points, is_unlimited_points
  on public.profiles
  for each row execute function public.trg_platform_buyer_unlimited_points();

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
  v_unlimited boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  select
    coalesce(current_points, points, 0),
    coalesce(is_unlimited_points, false)
  into v_before, v_unlimited
  from public.profiles
  where id = v_uid
  for update;

  if v_before is null then
    raise exception 'profile not found';
  end if;

  if v_unlimited then
    v_balance := 9999;
    update public.profiles
    set
      current_points = 9999,
      points = 9999,
      updated_at = now()
    where id = v_uid;
  else
    v_balance := greatest(v_before - p_amount, 0);

    update public.profiles
    set
      current_points = v_balance,
      points = v_balance,
      consumed_points = coalesce(consumed_points, 0) + p_amount,
      updated_at = now()
    where id = v_uid;
  end if;

  insert into public.points_transactions (
    user_id, related_supplier_id, related_material_id,
    transaction_type, amount, balance_after, description
  )
  values (
    v_uid, p_related_supplier_id, p_related_material_id,
    'consume',
    case when v_unlimited then 0 else p_amount end,
    v_balance,
    p_description
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
      v_order_type, coalesce(p_amount_cny, 0),
      case when v_unlimited then 0 else p_amount end,
      'completed', p_description
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
