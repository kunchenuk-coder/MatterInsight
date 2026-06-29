-- 为情绪板表开启 Supabase Realtime（postgres_changes）
-- 项目实际表名为 moodboards（非 mood_boards）

alter table public.moodboards replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'moodboards'
  ) then
    alter publication supabase_realtime add table public.moodboards;
  end if;
end $$;
