-- Designer follow graph + aggregate social stats for public profiles

create table if not exists public.designer_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint designer_follows_no_self check (follower_id <> following_id)
);

create index if not exists designer_follows_following_id_idx
  on public.designer_follows (following_id);

create index if not exists designer_follows_follower_id_idx
  on public.designer_follows (follower_id);

alter table public.designer_follows enable row level security;

drop policy if exists "designer_follows_select_authenticated" on public.designer_follows;
create policy "designer_follows_select_authenticated"
  on public.designer_follows
  for select
  to authenticated
  using (true);

drop policy if exists "designer_follows_insert_own" on public.designer_follows;
create policy "designer_follows_insert_own"
  on public.designer_follows
  for insert
  to authenticated
  with check (auth.uid() = follower_id);

drop policy if exists "designer_follows_delete_own" on public.designer_follows;
create policy "designer_follows_delete_own"
  on public.designer_follows
  for delete
  to authenticated
  using (auth.uid() = follower_id);

grant select, insert, delete on public.designer_follows to authenticated;

-- Aggregate counts (public read via RPC; does not expose individual saver identities)
create or replace function public.designer_social_stats(p_designer_id uuid)
returns table (
  followers_count bigint,
  following_count bigint,
  moodboard_favorites_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::bigint from public.designer_follows f where f.following_id = p_designer_id),
    (select count(*)::bigint from public.designer_follows f where f.follower_id = p_designer_id),
    (
      select count(*)::bigint
      from public.saved_moodboards sm
      inner join public.moodboards m on m.id = sm.moodboard_id
      where m.user_id = p_designer_id
        and m.visibility = 'public'
        and m.is_published = true
    );
$$;

revoke all on function public.designer_social_stats(uuid) from public;
grant execute on function public.designer_social_stats(uuid) to anon, authenticated;
