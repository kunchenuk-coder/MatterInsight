-- Add company display name for designer profiles

alter table public.profiles
  add column if not exists company text;
