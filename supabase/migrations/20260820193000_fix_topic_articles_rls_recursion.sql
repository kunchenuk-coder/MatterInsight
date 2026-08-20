-- Fix infinite recursion between topic_articles <-> topic_article_versions RLS.
-- Both tables used EXISTS subqueries on the other table; Postgres evaluates every
-- permissive policy, so INSERT/SELECT ... RETURNING recursed even for the owner.

create or replace function public.topic_article_has_published(p_article_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.topic_article_versions v
    where v.article_id = p_article_id
      and v.status = 'published'
  );
$$;

create or replace function public.topic_article_is_active(p_article_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.topic_articles a
    where a.id = p_article_id
      and a.is_archived = false
  );
$$;

create or replace function public.topic_article_owned_by(p_article_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.topic_articles a
    where a.id = p_article_id
      and a.supplier_id = p_uid
  );
$$;

revoke all on function public.topic_article_has_published(uuid) from public;
revoke all on function public.topic_article_is_active(uuid) from public;
revoke all on function public.topic_article_owned_by(uuid, uuid) from public;

grant execute on function public.topic_article_has_published(uuid) to anon, authenticated;
grant execute on function public.topic_article_is_active(uuid) to anon, authenticated;
grant execute on function public.topic_article_owned_by(uuid, uuid) to authenticated;

drop policy if exists "topic_articles_select_public_published" on public.topic_articles;
create policy "topic_articles_select_public_published"
  on public.topic_articles for select
  using (
    is_archived = false
    and public.topic_article_has_published(id)
  );

drop policy if exists "topic_versions_select_published" on public.topic_article_versions;
create policy "topic_versions_select_published"
  on public.topic_article_versions for select
  using (
    status = 'published'
    and public.topic_article_is_active(article_id)
  );

drop policy if exists "topic_versions_select_own_or_admin" on public.topic_article_versions;
create policy "topic_versions_select_own_or_admin"
  on public.topic_article_versions for select
  to authenticated
  using (
    public.is_admin()
    or public.topic_article_owned_by(article_id, auth.uid())
  );

drop policy if exists "topic_versions_insert_draft" on public.topic_article_versions;
create policy "topic_versions_insert_draft"
  on public.topic_article_versions for insert
  to authenticated
  with check (
    status = 'draft'
    and public.is_supplier()
    and public.topic_article_owned_by(article_id, auth.uid())
  );

drop policy if exists "topic_versions_update_working_content" on public.topic_article_versions;
create policy "topic_versions_update_working_content"
  on public.topic_article_versions for update
  to authenticated
  using (
    status in ('draft', 'rejected')
    and public.topic_article_owned_by(article_id, auth.uid())
  )
  with check (
    status in ('draft', 'rejected')
    and public.topic_article_owned_by(article_id, auth.uid())
  );

drop policy if exists "topic_versions_delete_draft_rejected" on public.topic_article_versions;
create policy "topic_versions_delete_draft_rejected"
  on public.topic_article_versions for delete
  to authenticated
  using (
    status in ('draft', 'rejected')
    and public.topic_article_owned_by(article_id, auth.uid())
  );
