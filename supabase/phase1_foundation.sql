-- =============================================================================
-- Matter Insight — Phase 1 Foundation (2026-07-03)
-- Paste this entire file into Supabase Dashboard → SQL Editor → Run
-- Prerequisite: public.materials + public.profiles from 001_initial_schema.sql
-- =============================================================================

-- ========== designer evaluation submissions (019 prerequisite) ==========
create table if not exists public.material_designer_evaluations (
  id uuid primary key default gen_random_uuid(),
  material_id text not null references public.materials(id) on delete cascade,
  designer_id uuid not null references public.profiles(id) on delete cascade,
  evaluations jsonb not null,
  created_at timestamptz not null default now(),
  unique (material_id, designer_id)
);

create index if not exists material_designer_evaluations_material_id_idx
  on public.material_designer_evaluations(material_id);

alter table public.material_designer_evaluations enable row level security;

drop policy if exists "material_designer_evaluations_select_authenticated"
  on public.material_designer_evaluations;
create policy "material_designer_evaluations_select_authenticated"
  on public.material_designer_evaluations for select
  to authenticated
  using (true);

drop policy if exists "material_designer_evaluations_insert_designer"
  on public.material_designer_evaluations;
create policy "material_designer_evaluations_insert_designer"
  on public.material_designer_evaluations for insert
  to authenticated
  with check (
    designer_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and lower(p.role) = 'designer'
    )
  );

-- ========== Phase 1: materials structured specs ==========
create or replace function public.jsonb_array_len(j jsonb)
returns integer
language sql
immutable
as $$
  select case
    when j is null or jsonb_typeof(j) <> 'array' then 0
    else jsonb_array_length(j)
  end;
$$;

alter table public.materials
  add column if not exists hard_specs jsonb not null default '[]'::jsonb,
  add column if not exists soft_specs jsonb not null default '[]'::jsonb,
  add column if not exists official_mood_tags text[] not null default '{}';

alter table public.materials
  drop constraint if exists materials_hard_specs_max_24;
alter table public.materials
  add constraint materials_hard_specs_max_24
  check (public.jsonb_array_len(hard_specs) <= 24);

alter table public.materials
  drop constraint if exists materials_soft_specs_max_24;
alter table public.materials
  add constraint materials_soft_specs_max_24
  check (public.jsonb_array_len(soft_specs) <= 24);

alter table public.materials
  drop constraint if exists materials_official_mood_tags_max_3;
alter table public.materials
  add constraint materials_official_mood_tags_max_3
  check (cardinality(official_mood_tags) <= 3);

alter table public.materials
  alter column supplier_id set not null;

alter table public.materials
  drop constraint if exists materials_status_phase1_check;
alter table public.materials
  add constraint materials_status_phase1_check
  check (status in ('draft', 'published', '已发布', '待审核'));

update public.materials set status = 'published' where status = '已发布';

drop policy if exists "materials_select_published" on public.materials;
create policy "materials_select_published"
  on public.materials for select
  using (is_pending = false and status in ('published', '已发布'));

create index if not exists materials_status_idx on public.materials(status);
create index if not exists materials_official_mood_tags_gin_idx
  on public.materials using gin (official_mood_tags);

-- ========== event_log — Human DNA behavior ledger ==========
create table if not exists public.event_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  material_id text references public.materials(id) on delete set null,
  action_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint event_log_action_type_check
    check (action_type in (
      'EVALUATE_X1',
      'TAG_MOOD_X2',
      'SUBMIT_STORY_X3',
      'MOODBOARD_USE_X4'
    ))
);

create index if not exists event_log_user_id_created_at_idx
  on public.event_log (user_id, created_at desc);
create index if not exists event_log_material_id_action_idx
  on public.event_log (material_id, action_type, created_at desc);
create index if not exists event_log_action_type_created_at_idx
  on public.event_log (action_type, created_at desc);

alter table public.event_log enable row level security;

drop policy if exists "event_log_insert_own" on public.event_log;
create policy "event_log_insert_own"
  on public.event_log for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "event_log_select_own" on public.event_log;
create policy "event_log_select_own"
  on public.event_log for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "event_log_admin_select_all" on public.event_log;
create policy "event_log_admin_select_all"
  on public.event_log for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and upper(p.role) = 'ADMIN'
    )
  );

grant select, insert on public.event_log to authenticated;

-- ========== RPC: log_material_event (frontend logMaterialEvent) ==========
create or replace function public.log_material_event(
  p_material_id text default null,
  p_action_type text default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_action_type is null or p_action_type not in (
    'EVALUATE_X1', 'TAG_MOOD_X2', 'SUBMIT_STORY_X3', 'MOODBOARD_USE_X4'
  ) then raise exception 'invalid action_type: %', p_action_type; end if;
  if p_material_id is not null and not exists (
    select 1 from public.materials where id = p_material_id
  ) then raise exception 'material not found: %', p_material_id; end if;

  insert into public.event_log (user_id, material_id, action_type, payload)
  values (v_uid, p_material_id, p_action_type, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.log_material_event(text, text, jsonb) to authenticated;

-- ========== RPC: submit_material_evaluation (+ auto EVALUATE_X1 event) ==========
create or replace function public.submit_material_evaluation(
  p_material_id text,
  p_evaluations jsonb
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
  v_data jsonb;
  v_human jsonb;
  v_current jsonb;
  v_vote_count integer;
  v_key text;
  v_next jsonb := '{}'::jsonb;
  v_prev numeric;
  v_sub numeric;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select lower(role) into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'designer' then raise exception 'only designers may submit evaluations'; end if;
  if exists (
    select 1 from public.material_designer_evaluations
    where material_id = p_material_id and designer_id = v_uid
  ) then raise exception 'already rated'; end if;

  select * into v_row from public.materials
  where id = p_material_id and is_pending = false and status in ('published', '已发布')
  for update;
  if not found then raise exception 'material not found or not published'; end if;

  insert into public.material_designer_evaluations (material_id, designer_id, evaluations)
  values (p_material_id, v_uid, p_evaluations);

  v_data := v_row.data;
  v_human := coalesce(v_data->'humanDna', '{}'::jsonb);
  v_current := coalesce(v_human->'evaluations', '{}'::jsonb);
  v_vote_count := coalesce((v_human->>'evaluation_vote_count')::integer, 0);

  for v_key in select unnest(array['aesthetics','durability','service','cleanliness','recommendation']) loop
    v_prev := coalesce((v_current->>v_key)::numeric, (p_evaluations->>v_key)::numeric);
    v_sub := (p_evaluations->>v_key)::numeric;
    v_next := v_next || jsonb_build_object(
      v_key, round(((v_prev * v_vote_count) + v_sub) / (v_vote_count + 1)::numeric, 1)
    );
  end loop;

  v_human := v_human
    || jsonb_build_object('evaluations', v_next)
    || jsonb_build_object('evaluation_vote_count', v_vote_count + 1);
  v_data := v_data || jsonb_build_object('humanDna', v_human)
    || jsonb_build_object('ratings', jsonb_build_object(
      'aesthetic', (v_next->>'aesthetics')::numeric,
      'durable', (v_next->>'durability')::numeric,
      'service', (v_next->>'service')::numeric,
      'cleanliness', (v_next->>'cleanliness')::numeric,
      'recommendation', (v_next->>'recommendation')::numeric
    ));

  update public.materials set data = v_data, updated_at = now() where id = p_material_id;

  perform public.log_material_event(
    p_material_id, 'EVALUATE_X1',
    jsonb_build_object('evaluations', p_evaluations, 'aggregate', v_next)
  );
  return v_next;
end;
$$;

grant execute on function public.submit_material_evaluation(text, jsonb) to authenticated;
