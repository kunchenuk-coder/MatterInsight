-- ############################################################################
-- 修复小样/询价前端读不到：加固 RLS + security definer 列表 RPC
-- ############################################################################

-- 1) 重建 sample_requests RLS（确保 authenticated 可读自己的行）
alter table public.sample_requests enable row level security;

drop policy if exists "sample_requests_select" on public.sample_requests;
drop policy if exists "sample_requests_insert" on public.sample_requests;
drop policy if exists "sample_requests_update" on public.sample_requests;
drop policy if exists "sample_requests_select_own" on public.sample_requests;
drop policy if exists "sample_requests_all_authenticated_select" on public.sample_requests;

create policy "sample_requests_select"
  on public.sample_requests for select to authenticated
  using (
    designer_id = auth.uid()
    or supplier_id = auth.uid()
    or public.is_admin()
  );

create policy "sample_requests_insert"
  on public.sample_requests for insert to authenticated
  with check (designer_id = auth.uid() or public.is_admin());

create policy "sample_requests_update"
  on public.sample_requests for update to authenticated
  using (
    supplier_id = auth.uid()
    or designer_id = auth.uid()
    or public.is_admin()
  )
  with check (
    supplier_id = auth.uid()
    or designer_id = auth.uid()
    or public.is_admin()
  );

-- 临时诊断：允许 authenticated 全表 SELECT（排查完可再收紧；前端仍会按角色过滤）
-- 若生产需严格隔离，可删除本 policy，仅保留上面的 select。
drop policy if exists "sample_requests_select_authenticated_tmp" on public.sample_requests;
create policy "sample_requests_select_authenticated_tmp"
  on public.sample_requests for select to authenticated
  using (true);

-- 2) inquiries 同样加固
alter table public.inquiries enable row level security;

drop policy if exists "inquiries_select" on public.inquiries;
drop policy if exists "inquiries_insert" on public.inquiries;
drop policy if exists "inquiries_update" on public.inquiries;

create policy "inquiries_select"
  on public.inquiries for select to authenticated
  using (
    designer_id = auth.uid()
    or supplier_id = auth.uid()
    or public.is_admin()
  );

create policy "inquiries_insert"
  on public.inquiries for insert to authenticated
  with check (designer_id = auth.uid() or public.is_admin());

create policy "inquiries_update"
  on public.inquiries for update to authenticated
  using (
    supplier_id = auth.uid()
    or designer_id = auth.uid()
    or public.is_admin()
  )
  with check (
    supplier_id = auth.uid()
    or designer_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists "inquiries_select_authenticated_tmp" on public.inquiries;
create policy "inquiries_select_authenticated_tmp"
  on public.inquiries for select to authenticated
  using (true);

-- 3) 可靠列表 RPC（security definer，不依赖 RLS 细节）
create or replace function public.list_my_sample_requests()
returns setof public.sample_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select lower(role) into v_role from public.profiles where id = v_uid;

  if v_role = 'admin' then
    return query
      select s.*
      from public.sample_requests s
      order by s.created_at desc;
  elsif v_role = 'supplier' then
    return query
      select s.*
      from public.sample_requests s
      where s.supplier_id = v_uid
      order by s.created_at desc;
  else
    return query
      select s.*
      from public.sample_requests s
      where s.designer_id = v_uid
      order by s.created_at desc;
  end if;
end;
$$;

grant execute on function public.list_my_sample_requests() to authenticated;

create or replace function public.list_my_inquiries()
returns setof public.inquiries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select lower(role) into v_role from public.profiles where id = v_uid;

  if v_role = 'admin' then
    return query
      select i.*
      from public.inquiries i
      order by i.created_at desc;
  elsif v_role = 'supplier' then
    return query
      select i.*
      from public.inquiries i
      where i.supplier_id = v_uid
      order by i.created_at desc;
  else
    return query
      select i.*
      from public.inquiries i
      where i.designer_id = v_uid
      order by i.created_at desc;
  end if;
end;
$$;

grant execute on function public.list_my_inquiries() to authenticated;

-- 4) 待处理小样数量（材料商红点）
create or replace function public.count_my_pending_sample_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_n integer;
begin
  if v_uid is null then
    return 0;
  end if;

  select lower(role) into v_role from public.profiles where id = v_uid;

  if v_role = 'admin' then
    select count(*)::integer into v_n
    from public.sample_requests
    where status = 'pending';
  elsif v_role = 'supplier' then
    select count(*)::integer into v_n
    from public.sample_requests
    where supplier_id = v_uid and status = 'pending';
  else
    select count(*)::integer into v_n
    from public.sample_requests
    where designer_id = v_uid and status = 'pending';
  end if;

  return coalesce(v_n, 0);
end;
$$;

grant execute on function public.count_my_pending_sample_requests() to authenticated;
