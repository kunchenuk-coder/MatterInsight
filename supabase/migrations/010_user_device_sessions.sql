-- 单设备类型在线限制：每用户最多 1 台手机 + 1 台 PC 同时在线（同类设备顶号）

create table if not exists public.user_device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_type text not null check (device_type in ('mobile', 'desktop')),
  session_id text not null,
  access_token text,
  updated_at timestamptz not null default now(),
  unique (user_id, device_type)
);

create index if not exists user_device_sessions_user_id_idx
  on public.user_device_sessions(user_id);

alter table public.user_device_sessions enable row level security;

create policy "device_sessions_select_own"
  on public.user_device_sessions for select
  using (auth.uid() = user_id);

create policy "device_sessions_insert_own"
  on public.user_device_sessions for insert
  with check (auth.uid() = user_id);

create policy "device_sessions_update_own"
  on public.user_device_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "device_sessions_delete_own"
  on public.user_device_sessions for delete
  using (auth.uid() = user_id);

-- Realtime：旧设备即时感知 session_id 被覆盖
alter table public.user_device_sessions replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_device_sessions'
  ) then
    alter publication supabase_realtime add table public.user_device_sessions;
  end if;
end $$;
