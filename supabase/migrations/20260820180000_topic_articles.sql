-- Matter Insight: What's New topic articles (article identity + versions + review RPCs)
-- Additive only. Does not alter materials / inspiration_stories / moodboards / auth.

-- ========== helpers ==========
create or replace function public.is_supplier()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and lower(role) = 'supplier'
  );
$$;

revoke all on function public.is_supplier() from public;
grant execute on function public.is_supplier() to anon, authenticated;

create or replace function public.topic_version_has_publishable_body(p_content jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  elem jsonb;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'array' then
    return false;
  end if;
  for elem in select value from jsonb_array_elements(p_content)
  loop
    if coalesce(elem->>'type', '') = 'text'
       and length(trim(coalesce(elem->>'content', ''))) > 0 then
      return true;
    end if;
    if coalesce(elem->>'type', '') = 'image'
       and length(trim(coalesce(elem->>'ossObjectKey', coalesce(elem->>'oss_object_key', '')))) > 0 then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

revoke all on function public.topic_version_has_publishable_body(jsonb) from public;
grant execute on function public.topic_version_has_publishable_body(jsonb) to authenticated;

-- ========== tables ==========
create table if not exists public.topic_articles (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.profiles(id) on delete cascade,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists topic_articles_supplier_idx
  on public.topic_articles (supplier_id, is_archived);

create index if not exists topic_articles_active_idx
  on public.topic_articles (is_archived)
  where is_archived = false;

comment on table public.topic_articles is
  'What''s New topic identity. Live content lives on topic_article_versions.';

create table if not exists public.topic_article_versions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.topic_articles(id) on delete cascade,
  title text not null default '',
  content jsonb not null default '[]'::jsonb,
  cover_image_object_key text,
  status text not null default 'draft'
    check (status in ('draft', 'pending_review', 'rejected', 'published', 'superseded')),
  rejection_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint topic_article_versions_title_len
    check (char_length(title) <= 150)
);

create index if not exists topic_article_versions_article_status_idx
  on public.topic_article_versions (article_id, status);

create index if not exists topic_article_versions_pending_queue_idx
  on public.topic_article_versions (submitted_at asc)
  where status = 'pending_review';

create index if not exists topic_article_versions_published_pool_idx
  on public.topic_article_versions (published_at desc)
  where status = 'published';

create unique index if not exists topic_article_versions_one_published
  on public.topic_article_versions (article_id)
  where status = 'published';

-- Per-article inflight working row (not global). Rejected history is unlimited.
create unique index if not exists topic_article_versions_one_inflight
  on public.topic_article_versions (article_id)
  where status in ('draft', 'pending_review');

comment on table public.topic_article_versions is
  'Topic content snapshots. One published + one inflight (draft|pending_review) per article.';

-- ========== status-field guard (clients cannot self-publish) ==========
create or replace function public.topic_article_versions_protect_review_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and current_setting('app.topic_status_ok', true) is distinct from 'on' then
    if new.status is distinct from old.status
       or new.reviewed_at is distinct from old.reviewed_at
       or new.reviewed_by is distinct from old.reviewed_by
       or new.published_at is distinct from old.published_at
       or new.submitted_at is distinct from old.submitted_at
       or new.rejection_reason is distinct from old.rejection_reason then
      raise exception 'topic version review fields can only change via RPC';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists topic_article_versions_protect_review_fields
  on public.topic_article_versions;
create trigger topic_article_versions_protect_review_fields
  before update on public.topic_article_versions
  for each row
  execute function public.topic_article_versions_protect_review_fields();

-- ========== RLS ==========
alter table public.topic_articles enable row level security;
alter table public.topic_article_versions enable row level security;

drop policy if exists "topic_articles_select_public_published" on public.topic_articles;
create policy "topic_articles_select_public_published"
  on public.topic_articles for select
  using (
    is_archived = false
    and exists (
      select 1 from public.topic_article_versions v
      where v.article_id = topic_articles.id and v.status = 'published'
    )
  );

drop policy if exists "topic_articles_select_own" on public.topic_articles;
create policy "topic_articles_select_own"
  on public.topic_articles for select
  to authenticated
  using (supplier_id = auth.uid() or public.is_admin());

drop policy if exists "topic_articles_insert_supplier" on public.topic_articles;
create policy "topic_articles_insert_supplier"
  on public.topic_articles for insert
  to authenticated
  with check (supplier_id = auth.uid() and public.is_supplier());

drop policy if exists "topic_versions_select_published" on public.topic_article_versions;
create policy "topic_versions_select_published"
  on public.topic_article_versions for select
  using (
    status = 'published'
    and exists (
      select 1 from public.topic_articles a
      where a.id = article_id and a.is_archived = false
    )
  );

drop policy if exists "topic_versions_select_own_or_admin" on public.topic_article_versions;
create policy "topic_versions_select_own_or_admin"
  on public.topic_article_versions for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.topic_articles a
      where a.id = article_id and a.supplier_id = auth.uid()
    )
  );

drop policy if exists "topic_versions_insert_draft" on public.topic_article_versions;
create policy "topic_versions_insert_draft"
  on public.topic_article_versions for insert
  to authenticated
  with check (
    status = 'draft'
    and public.is_supplier()
    and exists (
      select 1 from public.topic_articles a
      where a.id = article_id and a.supplier_id = auth.uid()
    )
  );

drop policy if exists "topic_versions_update_working_content" on public.topic_article_versions;
create policy "topic_versions_update_working_content"
  on public.topic_article_versions for update
  to authenticated
  using (
    status in ('draft', 'rejected')
    and exists (
      select 1 from public.topic_articles a
      where a.id = article_id and a.supplier_id = auth.uid()
    )
  )
  with check (
    status in ('draft', 'rejected')
    and exists (
      select 1 from public.topic_articles a
      where a.id = article_id and a.supplier_id = auth.uid()
    )
  );

drop policy if exists "topic_versions_delete_draft_rejected" on public.topic_article_versions;
create policy "topic_versions_delete_draft_rejected"
  on public.topic_article_versions for delete
  to authenticated
  using (
    status in ('draft', 'rejected')
    and exists (
      select 1 from public.topic_articles a
      where a.id = article_id and a.supplier_id = auth.uid()
    )
  );

grant select on public.topic_articles to anon, authenticated;
grant insert on public.topic_articles to authenticated;
grant select, insert, update, delete on public.topic_article_versions to authenticated;
grant select on public.topic_article_versions to anon;

-- ========== RPCs ==========
create or replace function public.submit_topic_article_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_ver public.topic_article_versions%rowtype;
  v_article public.topic_articles%rowtype;
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_version_id is null then
    raise exception 'version_id required';
  end if;

  select lower(role) into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'supplier' then
    raise exception 'only suppliers may submit topics';
  end if;

  perform set_config('app.topic_status_ok', 'on', true);

  select * into v_ver
  from public.topic_article_versions
  where id = p_version_id
  for update;
  if not found then
    raise exception 'version not found';
  end if;

  select * into v_article
  from public.topic_articles
  where id = v_ver.article_id
  for update;
  if not found or v_article.supplier_id is distinct from v_uid then
    raise exception 'not allowed';
  end if;
  if v_article.is_archived then
    raise exception 'archived topics cannot be submitted';
  end if;

  if length(trim(v_ver.title)) < 1 then
    raise exception 'title required';
  end if;
  if not public.topic_version_has_publishable_body(v_ver.content) then
    raise exception 'content required';
  end if;

  if v_ver.status = 'draft' then
    update public.topic_article_versions
    set
      status = 'pending_review',
      submitted_at = now(),
      rejection_reason = null,
      updated_at = now()
    where id = v_ver.id;
    return jsonb_build_object('ok', true, 'version_id', v_ver.id, 'status', 'pending_review');
  end if;

  if v_ver.status = 'rejected' then
    insert into public.topic_article_versions (
      article_id, title, content, cover_image_object_key, status, submitted_at
    ) values (
      v_ver.article_id, v_ver.title, v_ver.content, v_ver.cover_image_object_key,
      'pending_review', now()
    )
    returning id into v_new_id;
    return jsonb_build_object('ok', true, 'version_id', v_new_id, 'status', 'pending_review');
  end if;

  raise exception 'only draft or rejected versions can be submitted';
end;
$$;

create or replace function public.withdraw_topic_article_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ver public.topic_article_versions%rowtype;
  v_article public.topic_articles%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  perform set_config('app.topic_status_ok', 'on', true);

  select * into v_ver
  from public.topic_article_versions
  where id = p_version_id
  for update;
  if not found then
    raise exception 'version not found';
  end if;

  select * into v_article
  from public.topic_articles
  where id = v_ver.article_id
  for update;
  if not found or v_article.supplier_id is distinct from v_uid then
    raise exception 'not allowed';
  end if;
  if v_ver.status is distinct from 'pending_review' then
    raise exception 'only pending_review versions can be withdrawn';
  end if;

  update public.topic_article_versions
  set
    status = 'draft',
    submitted_at = null,
    updated_at = now()
  where id = v_ver.id;

  return jsonb_build_object('ok', true, 'version_id', v_ver.id, 'status', 'draft');
end;
$$;

create or replace function public.approve_topic_article_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ver public.topic_article_versions%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'only admin may approve topics';
  end if;

  perform set_config('app.topic_status_ok', 'on', true);

  select * into v_ver
  from public.topic_article_versions
  where id = p_version_id
  for update;
  if not found then
    raise exception 'version not found';
  end if;
  if v_ver.status is distinct from 'pending_review' then
    raise exception 'only pending_review versions can be approved';
  end if;

  update public.topic_article_versions
  set
    status = 'superseded',
    updated_at = now()
  where article_id = v_ver.article_id
    and status = 'published';

  update public.topic_article_versions
  set
    status = 'published',
    published_at = now(),
    reviewed_at = now(),
    reviewed_by = v_uid,
    rejection_reason = null,
    updated_at = now()
  where id = v_ver.id;

  update public.topic_articles
  set
    is_archived = false,
    updated_at = now()
  where id = v_ver.article_id;

  return jsonb_build_object('ok', true, 'version_id', v_ver.id, 'status', 'published');
end;
$$;

create or replace function public.reject_topic_article_version(p_version_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ver public.topic_article_versions%rowtype;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'only admin may reject topics';
  end if;
  if v_reason = '' then
    raise exception 'rejection_reason required';
  end if;

  perform set_config('app.topic_status_ok', 'on', true);

  select * into v_ver
  from public.topic_article_versions
  where id = p_version_id
  for update;
  if not found then
    raise exception 'version not found';
  end if;
  if v_ver.status is distinct from 'pending_review' then
    raise exception 'only pending_review versions can be rejected';
  end if;

  update public.topic_article_versions
  set
    status = 'rejected',
    rejection_reason = v_reason,
    reviewed_at = now(),
    reviewed_by = v_uid,
    updated_at = now()
  where id = v_ver.id;

  return jsonb_build_object('ok', true, 'version_id', v_ver.id, 'status', 'rejected');
end;
$$;

create or replace function public.archive_topic_article(p_article_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_article public.topic_articles%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select lower(role) into v_role from public.profiles where id = v_uid;
  select * into v_article
  from public.topic_articles
  where id = p_article_id
  for update;
  if not found then
    raise exception 'article not found';
  end if;

  if v_role = 'admin' then
    null;
  elsif v_role = 'supplier' and v_article.supplier_id = v_uid then
    null;
  else
    raise exception 'not allowed to archive this topic';
  end if;

  update public.topic_articles
  set is_archived = true, updated_at = now()
  where id = p_article_id;

  return jsonb_build_object('ok', true, 'article_id', p_article_id, 'is_archived', true);
end;
$$;

grant execute on function public.submit_topic_article_version(uuid) to authenticated;
grant execute on function public.withdraw_topic_article_version(uuid) to authenticated;
grant execute on function public.approve_topic_article_version(uuid) to authenticated;
grant execute on function public.reject_topic_article_version(uuid, text) to authenticated;
grant execute on function public.archive_topic_article(uuid) to authenticated;
