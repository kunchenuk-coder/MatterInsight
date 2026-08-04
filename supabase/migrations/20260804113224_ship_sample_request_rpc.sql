-- ############################################################################
-- 小样发货：security definer RPC，避免 RLS UPDATE 静默 0 行
-- ############################################################################

create or replace function public.ship_sample_request(
  p_request_id uuid,
  p_tracking_number text default null
)
returns public.sample_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_row public.sample_requests%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_request_id is null then
    raise exception 'request_id required';
  end if;

  select lower(role) into v_role from public.profiles where id = v_uid;
  if v_role is null then
    raise exception 'profile not found';
  end if;

  select * into v_row
  from public.sample_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'sample request not found';
  end if;

  -- 仅材料商本人或管理员可发货
  if v_role = 'admin' then
    null;
  elsif v_role = 'supplier' and v_row.supplier_id = v_uid then
    null;
  else
    raise exception 'not allowed to ship this sample request';
  end if;

  if v_row.status = 'shipped' or v_row.status = 'completed' then
    return v_row; -- 幂等：已发货直接返回
  end if;

  update public.sample_requests
  set
    status = 'shipped',
    tracking_number = coalesce(nullif(trim(p_tracking_number), ''), tracking_number),
    shipped_at = coalesce(shipped_at, now()),
    updated_at = now()
  where id = p_request_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.ship_sample_request(uuid, text) to authenticated;

comment on function public.ship_sample_request(uuid, text) is
  '材料商/管理员将小样申请标记为 shipped；security definer 保证可写';
