-- Designer follow audit log (append-only; populated by trigger on designer_follows)

create table if not exists public.designer_follow_events (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('follow', 'unfollow')),
  created_at timestamptz not null default now()
);

create index if not exists designer_follow_events_follower_idx
  on public.designer_follow_events (follower_id, created_at desc);

create index if not exists designer_follow_events_following_idx
  on public.designer_follow_events (following_id, created_at desc);

alter table public.designer_follow_events enable row level security;

drop policy if exists "designer_follow_events_select_authenticated" on public.designer_follow_events;
create policy "designer_follow_events_select_authenticated"
  on public.designer_follow_events for select
  to authenticated
  using (true);

grant select on public.designer_follow_events to authenticated;

create or replace function public.log_designer_follow_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.designer_follow_events (follower_id, following_id, action)
    values (new.follower_id, new.following_id, 'follow');
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.designer_follow_events (follower_id, following_id, action)
    values (old.follower_id, old.following_id, 'unfollow');
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists designer_follows_log_event on public.designer_follows;
create trigger designer_follows_log_event
  after insert or delete on public.designer_follows
  for each row execute function public.log_designer_follow_event();
