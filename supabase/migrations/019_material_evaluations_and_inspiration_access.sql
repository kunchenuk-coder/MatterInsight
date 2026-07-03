-- Matter Insight 019: designer material evaluations (RPC) + inspiration stories access note
--
-- Inspiration stories are stored in materials.data.humanDna.inspiration_stories (JSON).
-- Designers read them via existing policy materials_select_published (status = 已发布, is_pending = false).
-- No separate inspiration_stories table or RLS is required.

-- ========== designer evaluation submissions (one row per designer × material) ==========
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

-- ========== RPC: merge designer vote into materials.data.humanDna evaluations ==========
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
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select lower(role) into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'designer' then
    raise exception 'only designers may submit evaluations';
  end if;

  if exists (
    select 1 from public.material_designer_evaluations
    where material_id = p_material_id and designer_id = v_uid
  ) then
    raise exception 'already rated';
  end if;

  select * into v_row from public.materials
  where id = p_material_id and is_pending = false and status = '已发布'
  for update;

  if not found then
    raise exception 'material not found or not published';
  end if;

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
      v_key,
      round(((v_prev * v_vote_count) + v_sub) / (v_vote_count + 1)::numeric, 1)
    );
  end loop;

  v_human := v_human
    || jsonb_build_object('evaluations', v_next)
    || jsonb_build_object('evaluation_vote_count', v_vote_count + 1);

  v_data := v_data || jsonb_build_object('humanDna', v_human)
    || jsonb_build_object(
      'ratings',
      jsonb_build_object(
        'aesthetic', (v_next->>'aesthetics')::numeric,
        'durable', (v_next->>'durability')::numeric,
        'service', (v_next->>'service')::numeric,
        'cleanliness', (v_next->>'cleanliness')::numeric,
        'recommendation', (v_next->>'recommendation')::numeric
      )
    );

  update public.materials
  set data = v_data, updated_at = now()
  where id = p_material_id;

  return v_next;
end;
$$;

grant execute on function public.submit_material_evaluation(text, jsonb) to authenticated;
