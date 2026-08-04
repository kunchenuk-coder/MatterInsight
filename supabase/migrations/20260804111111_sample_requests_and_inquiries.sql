-- ############################################################################
-- 小样申请 + 询价单：持久化业务表 + RLS + 报价通知类型
-- ############################################################################

-- 1) sample_requests
create table if not exists public.sample_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  designer_id uuid not null references public.profiles(id) on delete cascade,
  supplier_id uuid not null references public.profiles(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  receiver_name text not null,
  phone text not null,
  address text not null,
  status text not null default 'pending'
    check (status in ('pending', 'shipped', 'completed')),
  tracking_number text,
  shipped_at timestamptz
);

create index if not exists sample_requests_supplier_idx
  on public.sample_requests (supplier_id, status, created_at desc);

create index if not exists sample_requests_designer_idx
  on public.sample_requests (designer_id, created_at desc);

create index if not exists sample_requests_material_idx
  on public.sample_requests (material_id);

alter table public.sample_requests enable row level security;

drop policy if exists "sample_requests_select" on public.sample_requests;
create policy "sample_requests_select"
  on public.sample_requests for select to authenticated
  using (
    designer_id = auth.uid()
    or supplier_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists "sample_requests_insert" on public.sample_requests;
create policy "sample_requests_insert"
  on public.sample_requests for insert to authenticated
  with check (designer_id = auth.uid() or public.is_admin());

drop policy if exists "sample_requests_update" on public.sample_requests;
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

-- 2) inquiries
create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  designer_id uuid not null references public.profiles(id) on delete cascade,
  supplier_id uuid not null references public.profiles(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  moodboard_id text,
  project_name text,
  project_location text,
  estimated_area numeric(12, 2),
  delivery_date date,
  remarks text,
  status text not null default 'pending'
    check (status in ('pending', 'quoted', 'closed')),
  supplier_quote_price numeric(12, 2),
  supplier_quote_note text,
  quoted_at timestamptz,
  quote_read_at timestamptz
);

create index if not exists inquiries_supplier_idx
  on public.inquiries (supplier_id, status, created_at desc);

create index if not exists inquiries_designer_idx
  on public.inquiries (designer_id, created_at desc);

create index if not exists inquiries_material_idx
  on public.inquiries (material_id);

alter table public.inquiries enable row level security;

drop policy if exists "inquiries_select" on public.inquiries;
create policy "inquiries_select"
  on public.inquiries for select to authenticated
  using (
    designer_id = auth.uid()
    or supplier_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists "inquiries_insert" on public.inquiries;
create policy "inquiries_insert"
  on public.inquiries for insert to authenticated
  with check (designer_id = auth.uid() or public.is_admin());

drop policy if exists "inquiries_update" on public.inquiries;
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

-- updated_at helpers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sample_requests_set_updated_at on public.sample_requests;
create trigger sample_requests_set_updated_at
  before update on public.sample_requests
  for each row execute function public.set_updated_at();

drop trigger if exists inquiries_set_updated_at on public.inquiries;
create trigger inquiries_set_updated_at
  before update on public.inquiries
  for each row execute function public.set_updated_at();

-- 3) 通知类型扩展：材料商报价 → 通知设计师
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'tag_added',
    'inquiry',
    'sample_request',
    'story_featured',
    'quote_received'
  ));

create or replace function public.create_notification(
  p_receiver_id uuid,
  p_type text,
  p_target_id uuid default null,
  p_sender_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_type text := lower(trim(coalesce(p_type, '')));
begin
  if p_receiver_id is null then
    raise exception 'receiver_id required';
  end if;

  if v_type not in (
    'tag_added', 'inquiry', 'sample_request', 'story_featured', 'quote_received'
  ) then
    raise exception 'invalid notification type';
  end if;

  if v_uid is null and not public.is_admin() then
    raise exception 'not authenticated';
  end if;

  insert into public.notifications (receiver_id, sender_id, type, target_id, is_read)
  values (
    p_receiver_id,
    coalesce(p_sender_id, v_uid),
    v_type,
    p_target_id,
    false
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_notification(uuid, text, uuid, uuid) to authenticated;

-- Realtime（可选）
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.sample_requests;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.inquiries;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
