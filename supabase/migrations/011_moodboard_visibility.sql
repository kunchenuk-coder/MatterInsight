-- MoodBoard visibility: private | team | public

alter table public.moodboards
  add column if not exists visibility text not null default 'private'
    check (visibility in ('private', 'team', 'public')),
  add column if not exists published_at timestamptz;

create index if not exists moodboards_public_list_idx
  on public.moodboards (published_at desc nulls last)
  where visibility = 'public';

-- Team collaborators (owner invites by user id)
create table if not exists public.moodboard_collaborators (
  id uuid primary key default gen_random_uuid(),
  moodboard_id text not null references public.moodboards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (moodboard_id, user_id)
);

create index if not exists moodboard_collaborators_board_idx
  on public.moodboard_collaborators(moodboard_id);

create index if not exists moodboard_collaborators_user_idx
  on public.moodboard_collaborators(user_id);

alter table public.moodboard_collaborators enable row level security;

-- Replace owner-only moodboards policy with visibility-aware rules
drop policy if exists "moodboards_own_all" on public.moodboards;

create policy "moodboards_select"
  on public.moodboards for select
  using (
    visibility = 'public'
    or (auth.uid() is not null and auth.uid() = user_id)
    or (
      auth.uid() is not null
      and visibility = 'team'
      and exists (
        select 1 from public.moodboard_collaborators c
        where c.moodboard_id = moodboards.id and c.user_id = auth.uid()
      )
    )
  );

create policy "moodboards_insert_own"
  on public.moodboards for insert
  with check (auth.uid() = user_id);

create policy "moodboards_update_own"
  on public.moodboards for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "moodboards_delete_own"
  on public.moodboards for delete
  using (auth.uid() = user_id);

create policy "moodboard_collaborators_select"
  on public.moodboard_collaborators for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.moodboards m
      where m.id = moodboard_collaborators.moodboard_id and m.user_id = auth.uid()
    )
  );

create policy "moodboard_collaborators_insert_owner"
  on public.moodboard_collaborators for insert
  with check (
    invited_by = auth.uid()
    and exists (
      select 1 from public.moodboards m
      where m.id = moodboard_collaborators.moodboard_id and m.user_id = auth.uid()
    )
  );

create policy "moodboard_collaborators_delete_owner"
  on public.moodboard_collaborators for delete
  using (
    exists (
      select 1 from public.moodboards m
      where m.id = moodboard_collaborators.moodboard_id and m.user_id = auth.uid()
    )
  );
