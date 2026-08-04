-- Matter Insight 025: Material Story system
-- Replaces undeployed 021 business rules. Do NOT deploy 021.
--
-- Rules:
--   • Single table: public.material_inspiration_stories (no second story table)
--   • Designer + Supplier may submit; all rows start as status = 'pending'
--   • Supplier: is_brand_story=true and must own the material
--   • Designer: is_brand_story=false
--   • Author may delete own rows; Admin may review (update status) and delete
--   • Cross-role cannot update/delete each other's stories
--   • Does not mutate materials / event_log schema / moodboards
--   • Does not copy story rows into materials.data or any other table

-- ############################################################################
-- 1. Table (unified Material Story store)
-- ############################################################################

create table if not exists public.material_inspiration_stories (
  id uuid primary key default gen_random_uuid(),
  material_id text not null references public.materials(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  story_text text not null,
  status text not null default 'pending',
  is_brand_story boolean not null default false,
  created_at timestamptz not null default now(),
  constraint material_inspiration_stories_status_check
    check (status in ('pending', 'approved', 'rejected')),
  constraint material_inspiration_stories_text_len
    check (char_length(story_text) between 12 and 800)
);

create index if not exists material_inspiration_stories_material_id_idx
  on public.material_inspiration_stories(material_id);

create index if not exists material_inspiration_stories_author_id_idx
  on public.material_inspiration_stories(author_id);

create index if not exists material_inspiration_stories_status_idx
  on public.material_inspiration_stories(status);

alter table public.material_inspiration_stories enable row level security;

-- ############################################################################
-- 2. RLS
-- ############################################################################

-- Read: approved stories for all authenticated users;
--       authors see own pending/rejected; admin sees all.
drop policy if exists "material_inspiration_stories_select_authenticated"
  on public.material_inspiration_stories;
drop policy if exists "material_inspiration_stories_select"
  on public.material_inspiration_stories;
create policy "material_inspiration_stories_select"
  on public.material_inspiration_stories for select
  to authenticated
  using (
    status = 'approved'
    or author_id = auth.uid()
    or public.is_admin()
  );

-- Insert: only as self (prefer RPC submit_inspiration_story for business rules)
drop policy if exists "material_inspiration_stories_insert_author"
  on public.material_inspiration_stories;
create policy "material_inspiration_stories_insert_author"
  on public.material_inspiration_stories for insert
  to authenticated
  with check (author_id = auth.uid());

-- Update: admin only (review approve/reject). Authors cannot edit after submit.
drop policy if exists "material_inspiration_stories_update_admin"
  on public.material_inspiration_stories;
create policy "material_inspiration_stories_update_admin"
  on public.material_inspiration_stories for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Delete: author deletes own story only; admin may delete any (违规).
-- Cross-role delete is blocked because author_id must match (unless admin).
drop policy if exists "material_inspiration_stories_delete_author_or_admin"
  on public.material_inspiration_stories;
create policy "material_inspiration_stories_delete_author_or_admin"
  on public.material_inspiration_stories for delete
  to authenticated
  using (
    author_id = auth.uid()
    or public.is_admin()
  );

-- ############################################################################
-- 3. RPC: submit_inspiration_story (name + params unchanged)
-- ############################################################################

create or replace function public.submit_inspiration_story(
  p_material_id text,
  p_story_text text,
  p_is_brand_story boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_story_id uuid;
  v_text text := trim(coalesce(p_story_text, ''));
  v_is_brand boolean := coalesce(p_is_brand_story, false);
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if char_length(v_text) < 12 or char_length(v_text) > 800 then
    raise exception 'story_text length must be between 12 and 800';
  end if;

  select lower(role) into v_role from public.profiles where id = v_uid;
  if v_role is null then
    raise exception 'profile not found';
  end if;

  if v_is_brand then
    -- Supplier official brand story: must own the material
    if v_role is distinct from 'supplier' then
      raise exception 'only suppliers may submit brand stories';
    end if;
    if not exists (
      select 1 from public.materials
      where id = p_material_id and supplier_id = v_uid
    ) then
      raise exception 'material not found or not owned by supplier';
    end if;
  else
    -- Designer inspiration story
    if v_role is distinct from 'designer' then
      raise exception 'only designers may submit inspiration stories';
    end if;
    if not exists (
      select 1 from public.materials
      where id = p_material_id
        and is_pending = false
        and status in ('published', '已发布', 'draft')
    ) then
      raise exception 'material not found or not available';
    end if;
  end if;

  -- All submissions require Admin review (never auto-approved)
  insert into public.material_inspiration_stories (
    material_id, author_id, story_text, status, is_brand_story
  )
  values (p_material_id, v_uid, v_text, 'pending', v_is_brand)
  returning id into v_story_id;

  -- Audit only via existing event_log RPC; do not write stories into materials.data
  perform public.log_material_event(
    p_material_id,
    'SUBMIT_STORY_X3',
    jsonb_build_object(
      'story_id', v_story_id::text,
      'story_text', v_text,
      'status', 'pending',
      'is_brand_story', v_is_brand
    )
  );

  return jsonb_build_object(
    'id', v_story_id::text,
    'author_id', v_uid::text,
    'text', v_text,
    'status', 'pending',
    'is_brand_story', v_is_brand
  );
end;
$$;

comment on function public.submit_inspiration_story(text, text, boolean) is
  'Material Story submit: designer (non-brand) or owning supplier (brand); always pending for admin review.';

grant execute on function public.submit_inspiration_story(text, text, boolean) to authenticated;

-- ############################################################################
-- 4. RPC: review_inspiration_story (admin approve / reject)
-- ############################################################################

create or replace function public.review_inspiration_story(
  p_story_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.material_inspiration_stories%rowtype;
  v_next text := lower(trim(coalesce(p_status, '')));
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'only admins may review stories';
  end if;

  if v_next not in ('approved', 'rejected') then
    raise exception 'status must be approved or rejected';
  end if;

  select * into v_row
  from public.material_inspiration_stories
  where id = p_story_id
  for update;

  if not found then
    raise exception 'story not found';
  end if;

  update public.material_inspiration_stories
  set status = v_next
  where id = p_story_id;

  return jsonb_build_object(
    'id', p_story_id::text,
    'status', v_next,
    'is_brand_story', v_row.is_brand_story,
    'material_id', v_row.material_id,
    'author_id', v_row.author_id::text
  );
end;
$$;

grant execute on function public.review_inspiration_story(uuid, text) to authenticated;

-- ############################################################################
-- 5. RPC: delete_inspiration_story (author own / admin any)
-- ############################################################################

create or replace function public.delete_inspiration_story(
  p_story_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.material_inspiration_stories%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row
  from public.material_inspiration_stories
  where id = p_story_id
  for update;

  if not found then
    raise exception 'story not found';
  end if;

  if v_row.author_id is distinct from v_uid and not public.is_admin() then
    raise exception 'not allowed to delete this story';
  end if;

  delete from public.material_inspiration_stories where id = p_story_id;

  return jsonb_build_object(
    'id', p_story_id::text,
    'deleted', true
  );
end;
$$;

grant execute on function public.delete_inspiration_story(uuid) to authenticated;
