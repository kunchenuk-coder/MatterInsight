-- 修复远程 RPC：
-- 1) list_material_evaluations 输出列 id 与表列歧义
-- 2) materials.id（uuid）与 text 参数比较

create or replace function public.material_display_name(p_material_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_data jsonb;
  v_name text;
begin
  select data into v_data from public.materials where id::text = p_material_id;
  if v_data is null then
    return '项目应用';
  end if;
  if jsonb_typeof(v_data->'name') = 'string' then
    v_name := nullif(trim(v_data->>'name'), '');
  elsif jsonb_typeof(v_data->'name') = 'object' then
    v_name := coalesce(
      nullif(trim(v_data->'name'->>'zh'), ''),
      nullif(trim(v_data->'name'->>'en'), '')
    );
  end if;
  return coalesce(v_name, '项目应用');
end;
$$;

create or replace function public.material_display_name(p_material_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public.material_display_name(p_material_id::text);
end;
$$;

grant execute on function public.material_display_name(text) to authenticated;
grant execute on function public.material_display_name(uuid) to authenticated;

create or replace function public.recompute_material_evaluation_aggregate(p_material_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb;
  v_human jsonb;
  v_next jsonb := '{}'::jsonb;
  v_count integer := 0;
  v_key text;
  v_avg numeric;
begin
  select count(*)::integer into v_count
  from public.material_designer_evaluations
  where material_id = p_material_id::uuid
    and status is distinct from 'revoked';

  for v_key in select unnest(array['aesthetics','durability','service','cleanliness','recommendation']) loop
    if v_count = 0 then
      v_avg := 4.0;
    else
      select round(avg((evaluations->>v_key)::numeric), 1) into v_avg
      from public.material_designer_evaluations
      where material_id = p_material_id::uuid
        and status is distinct from 'revoked';
    end if;
    v_next := v_next || jsonb_build_object(v_key, coalesce(v_avg, 4.0));
  end loop;

  select data into v_data from public.materials where id::text = p_material_id for update;
  if not found then
    raise exception 'material not found';
  end if;

  v_human := coalesce(v_data->'humanDna', '{}'::jsonb)
    || jsonb_build_object('evaluations', v_next)
    || jsonb_build_object('evaluation_vote_count', v_count);

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
  where id::text = p_material_id;

  return v_next || jsonb_build_object('evaluation_vote_count', v_count);
end;
$$;

create or replace function public.submit_material_evaluation(
  p_material_id text,
  p_evaluations jsonb,
  p_project_name text default null,
  p_commitment_confirmed boolean default false,
  p_project_adoption_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_eval_id uuid;
  v_project text;
  v_adoption uuid;
  v_supplier uuid;
  v_target uuid;
  v_aggregate jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select lower(role) into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'designer' then
    raise exception 'only designers may submit evaluations';
  end if;

  if p_commitment_confirmed is not true then
    raise exception 'commitment required';
  end if;

  if exists (
    select 1 from public.material_designer_evaluations
    where material_id::text = p_material_id and designer_id = v_uid
  ) then
    raise exception 'already rated';
  end if;

  if not exists (
    select 1 from public.materials
    where id::text = p_material_id
      and is_pending = false
      and status in ('published', '已发布')
  ) then
    raise exception 'material not found or not published';
  end if;

  v_adoption := p_project_adoption_id;
  if v_adoption is null then
    select id into v_adoption
    from public.material_project_adoptions
    where designer_id = v_uid
      and material_id::text = p_material_id
    order by
      case when status = 'approved' then 0 when status = 'pending_review' then 1 else 2 end,
      created_at desc
    limit 1;
  end if;

  v_project := nullif(trim(coalesce(p_project_name, '')), '');
  if v_project is null then
    select nullif(trim(i.project_name), '') into v_project
    from public.inquiries i
    where i.designer_id = v_uid
      and i.material_id::text = p_material_id
      and nullif(trim(i.project_name), '') is not null
    order by i.created_at desc
    limit 1;
  end if;
  if v_project is null and v_adoption is not null then
    v_project := public.material_display_name(p_material_id) || ' 项目案例';
  end if;
  if v_project is null then
    v_project := public.material_display_name(p_material_id);
  end if;

  insert into public.material_designer_evaluations (
    material_id, designer_id, evaluations, project_name, project_adoption_id,
    commitment_confirmed, status, updated_at
  )
  values (
    p_material_id::uuid, v_uid, p_evaluations, v_project, v_adoption,
    true, 'submitted', now()
  )
  returning id into v_eval_id;

  v_aggregate := public.recompute_material_evaluation_aggregate(p_material_id);

  select supplier_id into v_supplier from public.materials where id::text = p_material_id;
  v_target := coalesce(public.try_material_uuid(p_material_id), v_eval_id);

  if v_supplier is not null and v_supplier is distinct from v_uid then
    insert into public.notifications (receiver_id, sender_id, type, target_id, is_read)
    values (v_supplier, v_uid, 'evaluation_added', v_target, false);
  end if;

  perform public.log_material_event(
    p_material_id,
    'EVALUATE_X1',
    jsonb_build_object('evaluations', p_evaluations, 'aggregate', v_aggregate, 'project_name', v_project)
  );

  return v_aggregate || jsonb_build_object('evaluation_id', v_eval_id, 'project_name', v_project);
end;
$$;

create or replace function public.dispute_material_evaluation(p_evaluation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_row public.material_designer_evaluations%rowtype;
  v_supplier uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select lower(role) into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'supplier' and v_role is distinct from 'admin' then
    raise exception 'only supplier or admin may dispute';
  end if;

  select * into v_row
  from public.material_designer_evaluations
  where id = p_evaluation_id
  for update;

  if not found then
    raise exception 'evaluation not found';
  end if;

  select supplier_id into v_supplier from public.materials where id::text = v_row.material_id::text;
  if v_role = 'supplier' and v_supplier is distinct from v_uid then
    raise exception 'not your material';
  end if;

  if v_row.status = 'revoked' then
    raise exception 'evaluation revoked';
  end if;

  update public.material_designer_evaluations
  set status = 'disputed',
      disputed_at = now(),
      disputed_by = v_uid,
      updated_at = now()
  where id = p_evaluation_id;

  perform public.notify_admins_evaluation_disputed(p_evaluation_id, v_uid);

  return jsonb_build_object('ok', true, 'status', 'disputed', 'evaluation_id', p_evaluation_id);
end;
$$;

create or replace function public.list_material_evaluations(p_material_id text default null)
returns table (
  id uuid,
  material_id text,
  designer_id uuid,
  designer_name text,
  designer_email text,
  designer_username text,
  project_name text,
  evaluations jsonb,
  status text,
  commitment_confirmed boolean,
  created_at timestamptz,
  updated_at timestamptz,
  disputed_at timestamptz,
  supplier_id uuid,
  supplier_phone text,
  material_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select lower(role) into v_role from public.profiles where id = v_uid;

  return query
  select
    e.id,
    e.material_id::text,
    e.designer_id,
    coalesce(nullif(trim(dp.company), ''), nullif(trim(dp.username), ''), dp.email, '设计师')::text,
    case when v_role = 'admin' then dp.email::text else ''::text end,
    case when v_role = 'admin' then dp.username::text else ''::text end,
    e.project_name,
    e.evaluations,
    e.status,
    e.commitment_confirmed,
    e.created_at,
    e.updated_at,
    e.disputed_at,
    m.supplier_id,
    case when v_role = 'admin' then coalesce(sp.registered_phone, '') else '' end::text,
    public.material_display_name(e.material_id::text)
  from public.material_designer_evaluations e
  join public.profiles dp on dp.id = e.designer_id
  left join public.materials m on m.id::text = e.material_id::text
  left join public.profiles sp on sp.id::text = m.supplier_id::text
  where (p_material_id is null or e.material_id::text = p_material_id)
    and (
      v_role = 'admin'
      or e.designer_id = v_uid
      or m.supplier_id::text = v_uid::text
    )
  order by
    case when e.status = 'disputed' then 0 else 1 end,
    e.updated_at desc;
end;
$$;

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
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_action_type is null or p_action_type not in (
    'EVALUATE_X1', 'TAG_MOOD_X2', 'SUBMIT_STORY_X3', 'MOODBOARD_USE_X4'
  ) then
    raise exception 'invalid action_type: %', p_action_type;
  end if;

  if p_material_id is not null and not exists (
    select 1 from public.materials where id::text = p_material_id
  ) then
    raise exception 'material not found: %', p_material_id;
  end if;

  insert into public.event_log (user_id, material_id, action_type, payload)
  values (v_uid, p_material_id::uuid, p_action_type, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;
