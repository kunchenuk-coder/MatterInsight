-- Moodboard publish gate: visibility=public only allows publish; is_published controls home feed

alter table public.moodboards
  add column if not exists is_published boolean not null default false;

-- published_at already added in 011_moodboard_visibility.sql

drop index if exists moodboards_public_list_idx;

create index if not exists moodboards_public_list_idx
  on public.moodboards (published_at desc nulls last)
  where visibility = 'public' and is_published = true;
