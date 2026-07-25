-- Matter Insight 021: inspiration stories table + submit RPC (SUBMIT_STORY_X3)

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

alter table public.material_inspiration_stories enable row level security;

drop policy if exists "material_inspiration_stories_select_authenticated"
  on public.material_inspiration_stories;
create policy "material_inspiration_stories_select_authenticated"
  on public.material_inspiration_stories for select
  to authenticated
  using (true);

drop policy if exists "material_inspiration_stories_insert_author"
  on public.material_inspiration_stories;
create policy "material_inspiration_stories_insert_author"
  on public.material_inspiration_stories for insert
  to authenticated
  with check (author_id = auth.uid());

-- ========== RPC: submit inspiration story + log SUBMIT_STORY_X3 ==========
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
  v_row public.materials%rowtype;
  v_story_id uuid;
  v_status text;
  v_data jsonb;
  v_human jsonb;
  v_stories jsonb;
  v_new_story jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select lower(role) into v_role from public.profiles where id = v_uid;

  if p_is_brand_story then
    select * into v_row from public.materials
    where id = p_material_id and supplier_id = v_uid
    for update;
    if not found then
      raise exception 'material not found or not owned by supplier';
    end if;
    v_status := 'approved';
  else
    if v_role is distinct from 'designer' then
      raise exception 'only designers may submit inspiration stories';
    end if;
    select * into v_row from public.materials
    where id = p_material_id
      and is_pending = false
      and status in ('published', '已发布', 'draft')
    for update;
    if not found then
      raise exception 'material not found or not available';
    end if;
    v_status := 'pending';
  end if;

  insert into public.material_inspiration_stories (
    material_id, author_id, story_text, status, is_brand_story
  )
  values (p_material_id, v_uid, p_story_text, v_status, coalesce(p_is_brand_story, false))
  returning id into v_story_id;

  if v_status = 'approved' then
    v_data := v_row.data;
    v_human := coalesce(v_data->'humanDna', '{}'::jsonb);
    v_stories := coalesce(v_human->'inspiration_stories', '[]'::jsonb);
    v_new_story := jsonb_build_object(
      'id', v_story_id::text,
      'author_id', v_uid::text,
      'text', p_story_text,
      'status', v_status
    );
    v_human := v_human || jsonb_build_object(
      'inspiration_stories', jsonb_build_array(v_new_story) || v_stories
    );
    v_data := v_data || jsonb_build_object('humanDna', v_human);
    update public.materials
    set data = v_data, updated_at = now()
    where id = p_material_id;
  end if;

  perform public.log_material_event(
    p_material_id,
    'SUBMIT_STORY_X3',
    jsonb_build_object(
      'story_id', v_story_id::text,
      'story_text', p_story_text,
      'status', v_status,
      'is_brand_story', coalesce(p_is_brand_story, false)
    )
  );

  return jsonb_build_object(
    'id', v_story_id::text,
    'author_id', v_uid::text,
    'text', p_story_text,
    'status', v_status
  );
end;
$$;

grant execute on function public.submit_inspiration_story(text, text, boolean) to authenticated;
