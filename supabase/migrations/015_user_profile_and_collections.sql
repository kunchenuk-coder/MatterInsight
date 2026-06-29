-- User profile fields, moodboard collections, material custom flag

-- ========== 1. Profile public fields ==========
alter table public.profiles
  add column if not exists username text,
  add column if not exists avatar text,
  add column if not exists bio text;

alter table public.profiles
  drop constraint if exists profiles_bio_length;

alter table public.profiles
  add constraint profiles_bio_length check (bio is null or char_length(bio) <= 100);

-- Backfill username: email prefix + short id suffix to avoid unique collisions
update public.profiles
set username = split_part(email, '@', 1) || '_' || substr(replace(id::text, '-', ''), 1, 6)
where username is null or trim(username) = '';

alter table public.profiles
  alter column username set not null;

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

-- Signup: default username to email prefix
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
begin
  v_username := split_part(coalesce(new.email, 'user'), '@', 1);
  insert into public.profiles (id, email, role, username, status, is_verified)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(lower(new.raw_user_meta_data->>'role'), 'designer'),
    v_username,
    'approved',
    true
  )
  on conflict (id) do update
    set username = coalesce(public.profiles.username, excluded.username),
        email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Designer profiles readable for public pages (own row still covered by existing policies)
drop policy if exists "profiles_select_designers" on public.profiles;
create policy "profiles_select_designers"
  on public.profiles
  for select
  using (lower(role) = 'designer');

-- ========== 2. Collected moodboards (M:N) ==========
create table if not exists public.saved_moodboards (
  user_id uuid not null references auth.users(id) on delete cascade,
  moodboard_id text not null references public.moodboards(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, moodboard_id)
);

create index if not exists saved_moodboards_user_id_idx
  on public.saved_moodboards (user_id);

create index if not exists saved_moodboards_moodboard_id_idx
  on public.saved_moodboards (moodboard_id);

alter table public.saved_moodboards enable row level security;

drop policy if exists "saved_moodboards_select_own" on public.saved_moodboards;
create policy "saved_moodboards_select_own"
  on public.saved_moodboards
  for select
  using (auth.uid() = user_id);

drop policy if exists "saved_moodboards_insert_own" on public.saved_moodboards;
create policy "saved_moodboards_insert_own"
  on public.saved_moodboards
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.moodboards m
      where m.id = moodboard_id
        and m.visibility = 'public'
        and m.is_published = true
    )
  );

drop policy if exists "saved_moodboards_delete_own" on public.saved_moodboards;
create policy "saved_moodboards_delete_own"
  on public.saved_moodboards
  for delete
  using (auth.uid() = user_id);

grant select, insert, delete on public.saved_moodboards to authenticated;

-- ========== 3. Material custom origin ==========
alter table public.materials
  add column if not exists is_custom boolean not null default false;

alter table public.local_materials
  add column if not exists is_custom boolean not null default true;
