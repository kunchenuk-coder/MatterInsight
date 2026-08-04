-- Matter Insight 024 — V5 architecture incremental evolution
-- Confirmed decisions:
--   1) 12 material categories (4 without Physical DNA dictionary yet)
--   2) Deduped model (no user_interactions / duplicate review logs / no array duplication)
--   3) Empty AI interface tables + trigger framework now (entity_embeddings, kg_sync_outbox, tag_relationships)
--   4) Incremental migration — preserve legacy columns & test accounts
--
-- Compatibility notes:
--   • materials.id remains TEXT (legacy catalog ids)
--   • Keep materials.data / hard_specs / soft_specs / official_mood_tags
--   • Keep event_log (Human DNA X1–X4); add user_events as broader append-only stream
--   • Keep moodboards / material_inspiration_stories / saved_materials; add relational bridges
--   • entity_id columns are TEXT so they can reference uuid profiles OR text material ids

-- ############################################################################
-- 0. Helpers
-- ############################################################################

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and lower(p.role) = 'admin'
  );
$$;

comment on function public.is_admin() is
  'True when auth.uid() has profiles.role = admin (case-insensitive).';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ############################################################################
-- 1. categories — 12 taxonomy + Physical DNA form engine
-- ############################################################################

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  category_code text not null unique,
  category_name text not null,
  attribute_keys jsonb not null default '[]'::jsonb,
  attribute_labels jsonb not null default '[]'::jsonb,
  attribute_units jsonb not null default '[]'::jsonb,
  attribute_types jsonb not null default '[]'::jsonb,
  attribute_ranges jsonb not null default '[]'::jsonb,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_attr_array_lengths_check check (
    jsonb_typeof(attribute_keys) = 'array'
    and jsonb_typeof(attribute_labels) = 'array'
    and jsonb_typeof(attribute_units) = 'array'
    and jsonb_typeof(attribute_types) = 'array'
    and jsonb_typeof(attribute_ranges) = 'array'
    and jsonb_array_length(attribute_keys) = jsonb_array_length(attribute_labels)
    and jsonb_array_length(attribute_keys) = jsonb_array_length(attribute_units)
    and jsonb_array_length(attribute_keys) = jsonb_array_length(attribute_types)
    and jsonb_array_length(attribute_keys) = jsonb_array_length(attribute_ranges)
  )
);

comment on table public.categories is
  'Material taxonomy (12 codes). attribute_* arrays drive Physical DNA forms (EAV schema).';

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

alter table public.categories enable row level security;

drop policy if exists "categories_select_all" on public.categories;
create policy "categories_select_all"
  on public.categories for select
  to authenticated
  using (true);

drop policy if exists "categories_admin_write" on public.categories;
create policy "categories_admin_write"
  on public.categories for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.categories to authenticated;
grant select, insert, update, delete on public.categories to authenticated;

-- Seed 12 categories (upsert). DNA filled for 9; WD/GL/SF/OT empty for later.
insert into public.categories as c (
  category_code, category_name, display_order,
  attribute_keys, attribute_labels, attribute_units, attribute_types, attribute_ranges
) values
(
  'ST', '石材', 1,
  '["density","water_absorption","mohs_hardness","compressive_strength","wear_resistance","veining_pattern","naturalness","surface_finish","thermal_feeling","acoustic_response","radioactivity_level","freeze_thaw_resistance","stain_protection","flexural_strength"]'::jsonb,
  '["密度","吸水率","莫氏硬度","抗压强度","耐磨性","纹理","天然程度","表面处理","冷热感","声音反馈","放射性等级","抗冻性/防冻融","防污/防护处理","弯曲强度"]'::jsonb,
  '["g/cm³","%","级","MPa","","","","","","","","","",""]'::jsonb,
  '["number","number","number","number","text","text","text","text","text","text","text","text","text","number"]'::jsonb,
  '[{"min":1.5,"max":3.5},{"min":0,"max":15},{"min":1,"max":10},{"min":0,"max":300},null,null,null,null,null,null,null,null,null,{"min":0,"max":50}]'::jsonb
),
(
  'CT', '瓷砖', 2,
  '["size_dimension","slip_resistance","stain_resistance","water_absorption","glaze_finish","pattern_reproduction","mohs_hardness","freeze_resistance","installation_method","tolerances"]'::jsonb,
  '["规格尺寸","防滑等级","耐污等级","吸水率","釉面","纹理复制","莫氏硬度","抗冻性","施工方式","平整度/边直度"]'::jsonb,
  '["","","","%","","","级","","",""]'::jsonb,
  '["text","text","text","number","text","text","number","text","text","text"]'::jsonb,
  '[null,null,null,{"min":0,"max":15},null,null,{"min":1,"max":10},null,null,null]'::jsonb
),
(
  'CO', '水泥', 3,
  '["strength_grade","concrete_type","setting_time","compressive_strength","flexural_strength","fineness_aggregate_size","surface_finish","moisture_resistance","crack_resistance","wear_resistance","color_pigment","application_method","environmental_rating"]'::jsonb,
  '["强度等级","类型/基材","凝结时间","抗压强度","抗折/抗拉强度","细度/粒径","表面处理","防潮/防水性","防开裂性","耐磨性","颜色/色号","施工方式","环保等级"]'::jsonb,
  '["","","","MPa","MPa","","","","","","","",""]'::jsonb,
  '["text","text","text","number","number","text","text","text","text","text","text","text","text"]'::jsonb,
  '[null,null,null,{"min":0,"max":120},{"min":0,"max":30},null,null,null,null,null,null,null,null]'::jsonb
),
(
  'WD', '木材', 4,
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
),
(
  'GL', '玻璃', 5,
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
),
(
  'SF', '饰面材料', 6,
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
),
(
  'MT', '金属', 7,
  '["metal_type","oxidation_level","gloss_level","reflectivity","corrosion_resistance","fabrication_technique","thermal_touch"]'::jsonb,
  '["金属类型","氧化程度","光泽度","反射率","耐腐蚀性","加工工艺","触感温度"]'::jsonb,
  '["","","","","","",""]'::jsonb,
  '["text","text","text","text","text","text","text"]'::jsonb,
  '[null,null,null,null,null,null,null]'::jsonb
),
(
  'PL', '塑料', 8,
  '["plastic_type","flexibility","transparency","weather_resistance","sustainability_rating","recyclability"]'::jsonb,
  '["塑料类型","柔韧性","透明度","耐候性","环保等级","回收等级"]'::jsonb,
  '["","","","","",""]'::jsonb,
  '["text","text","text","text","text","text"]'::jsonb,
  '[null,null,null,null,null,null]'::jsonb
),
(
  'FB', '布料/皮革', 9,
  '["fiber_type","texture","softness","tactile_feeling","abrasion_resistance","water_resistance","fire_resistance","breathability"]'::jsonb,
  '["纤维类型","纹理","柔软度","触感","耐磨性","防水性","阻燃性","透气性"]'::jsonb,
  '["","","","","","","",""]'::jsonb,
  '["text","text","text","text","text","text","text","text"]'::jsonb,
  '[null,null,null,null,null,null,null,null]'::jsonb
),
(
  'CP', '地毯', 10,
  '["pile_height","density","sound_absorption","wear_resistance","fire_resistance","cleaning_difficulty","material"]'::jsonb,
  '["绒高","密度","吸音性能","耐磨性","阻燃性","清洁难度","材质"]'::jsonb,
  '["mm","","","","","",""]'::jsonb,
  '["number","text","text","text","text","text","text"]'::jsonb,
  '[{"min":0,"max":50},null,null,null,null,null,null]'::jsonb
),
(
  'LT', '灯具', 11,
  '["brightness_lumen","cri","wattage","beam_angle","material","lifespan"]'::jsonb,
  '["亮度","显色指数","功率","光束角","材料","使用寿命"]'::jsonb,
  '["lm","","W","°","","h"]'::jsonb,
  '["number","number","number","number","text","text"]'::jsonb,
  '[{"min":0,"max":100000},{"min":0,"max":100},{"min":0,"max":1000},{"min":0,"max":360},null,null]'::jsonb
),
(
  'AC', '家具软装', 12,
  '["structure","filling_material","upholstery_fabric","comfort_level","functionality","style"]'::jsonb,
  '["结构","填充材料","面料","舒适度","功能","风格"]'::jsonb,
  '["","","","","",""]'::jsonb,
  '["text","text","text","text","text","text"]'::jsonb,
  '[null,null,null,null,null,null]'::jsonb
),
(
  'OT', '其他', 13,
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
)
on conflict (category_code) do update set
  category_name = excluded.category_name,
  display_order = excluded.display_order,
  attribute_keys = excluded.attribute_keys,
  attribute_labels = excluded.attribute_labels,
  attribute_units = excluded.attribute_units,
  attribute_types = excluded.attribute_types,
  attribute_ranges = excluded.attribute_ranges,
  updated_at = now();

-- ############################################################################
-- 2. materials — additive structured columns (keep legacy JSON)
-- ############################################################################

alter table public.materials
  add column if not exists category_code text,
  add column if not exists name text,
  add column if not exists brand text,
  add column if not exists description text,
  add column if not exists product_code text,
  add column if not exists mi_code text,
  add column if not exists mi_qr_code text,
  add column if not exists cover_image_url text,
  add column if not exists color text,
  add column if not exists price_range text,
  add column if not exists stock_produce_time text,
  add column if not exists uploaded_by text,
  add column if not exists origin text,
  add column if not exists sub_category text,
  add column if not exists moodboard_count integer not null default 0,
  add column if not exists points_balance_snapshot bigint;

-- Soft FK to categories (nullable during backfill)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'materials_category_code_fkey'
  ) then
    alter table public.materials
      add constraint materials_category_code_fkey
      foreign key (category_code) references public.categories(category_code)
      on update cascade on delete set null;
  end if;
end $$;

create index if not exists materials_category_code_idx on public.materials(category_code);
create unique index if not exists materials_mi_code_uidx
  on public.materials(mi_code) where mi_code is not null;

-- Expand status lifecycle (keep legacy values)
alter table public.materials drop constraint if exists materials_status_phase1_check;
alter table public.materials drop constraint if exists materials_status_v5_check;
alter table public.materials
  add constraint materials_status_v5_check
  check (status in (
    'draft', 'pending_review', 'published', 'hidden', 'rejected', 'deleted',
    '已发布', '待审核'
  ));

comment on column public.materials.category_code is
  'ST|CT|CO|WD|GL|SF|MT|PL|FB|CP|LT|AC|OT — links to categories form engine.';
comment on column public.materials.data is
  'LEGACY jsonb blob — retained for backward compatibility during incremental cutover.';

-- Best-effort backfill from legacy data jsonb
update public.materials m
set
  name = coalesce(nullif(m.name, ''), nullif(m.data->>'name', ''), m.id),
  brand = coalesce(m.brand, nullif(m.data->>'brand', '')),
  description = coalesce(m.description, nullif(m.data->>'description', '')),
  cover_image_url = coalesce(
    m.cover_image_url,
    nullif(m.data->>'imageUrl', ''),
    nullif(m.data->>'image_url', ''),
    nullif(m.data->>'cover_image_url', '')
  ),
  color = coalesce(m.color, nullif(m.data->>'color', ''), nullif(m.data->>'colour', '')),
  product_code = coalesce(m.product_code, nullif(m.data->>'productCode', ''), nullif(m.data->>'product_code', '')),
  category_code = coalesce(
    m.category_code,
    case upper(coalesce(m.data->>'category', m.data->>'material_type_code', ''))
      when 'STONE' then 'ST'
      when 'ST' then 'ST'
      when 'TILE' then 'CT'
      when 'CERAMIC' then 'CT'
      when 'CT' then 'CT'
      when 'CONCRETE' then 'CO'
      when 'CEMENT' then 'CO'
      when 'CO' then 'CO'
      when 'WOOD' then 'WD'
      when 'WD' then 'WD'
      when 'GLASS' then 'GL'
      when 'GL' then 'GL'
      when 'SURFACE' then 'SF'
      when 'SF' then 'SF'
      when 'METAL' then 'MT'
      when 'MT' then 'MT'
      when 'PLASTIC' then 'PL'
      when 'PL' then 'PL'
      when 'FABRIC' then 'FB'
      when 'LEATHER' then 'FB'
      when 'FB' then 'FB'
      when 'CARPET' then 'CP'
      when 'CP' then 'CP'
      when 'LIGHTING' then 'LT'
      when 'LT' then 'LT'
      when 'FURNITURE' then 'AC'
      when 'AC' then 'AC'
      when 'ACC' then 'AC'
      else null
    end
  )
where true;

-- profiles additive fields (do not delete test accounts)
alter table public.profiles
  add column if not exists full_name text,
  add column if not exists avatar_url text,
  add column if not exists phone text,
  add column if not exists studio_name text,
  add column if not exists level integer not null default 1,
  add column if not exists company_name text,
  add column if not exists license_image_url text,
  add column if not exists permissions jsonb,
  add column if not exists points_balance bigint not null default 0,
  add column if not exists last_login_at timestamptz,
  add column if not exists last_logout_at timestamptz;

-- Align common aliases from existing columns
update public.profiles
set
  full_name = coalesce(nullif(full_name, ''), nullif(username, ''), split_part(email, '@', 1)),
  avatar_url = coalesce(nullif(avatar_url, ''), avatar),
  phone = coalesce(nullif(phone, ''), registered_phone),
  company_name = coalesce(nullif(company_name, ''), company),
  license_image_url = coalesce(nullif(license_image_url, ''), verification_doc_url),
  points_balance = coalesce(points_balance, points, 0)
where true;

-- ############################################################################
-- 3. Role extension tables (1:1 with profiles)
-- ############################################################################

create table if not exists public.designers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  studio_name text,
  specialty text[] not null default '{}',
  level integer not null default 1,
  total_works integer not null default 0,
  total_followers integer not null default 0,
  total_following integer not null default 0,
  bio text,
  portfolio_urls text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  company_name text,
  license_image_url text,
  is_verified boolean not null default false,
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'approved', 'rejected', 'revoked')),
  total_materials integer not null default 0,
  total_points_consumed bigint not null default 0,
  total_points_remaining bigint not null default 0,
  total_payment_amount numeric(12,2) not null default 0,
  last_payment_time timestamptz,
  cooperation_status text not null default 'active'
    check (cooperation_status in ('active', 'inactive', 'blacklisted')),
  rating numeric(3,2) not null default 0,
  response_rate numeric(5,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_staff (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  staff_name text not null,
  role_type text not null default 'reviewer'
    check (role_type in ('super_admin', 'editor', 'reviewer', 'analyst', 'guest')),
  permissions text[] not null default '{}',
  assigned_by uuid references public.profiles(id) on delete set null,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists designers_set_updated_at on public.designers;
create trigger designers_set_updated_at
  before update on public.designers
  for each row execute function public.set_updated_at();

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

drop trigger if exists admin_staff_set_updated_at on public.admin_staff;
create trigger admin_staff_set_updated_at
  before update on public.admin_staff
  for each row execute function public.set_updated_at();

-- Backfill role extensions from existing profiles (no deletes)
insert into public.designers (profile_id, studio_name, bio, level)
select p.id, p.studio_name, p.bio, coalesce(p.level, 1)
from public.profiles p
where lower(p.role) = 'designer'
on conflict (profile_id) do nothing;

insert into public.suppliers (
  profile_id, company_name, license_image_url, is_verified,
  verification_status, total_points_remaining
)
select
  p.id,
  coalesce(p.company_name, p.company),
  coalesce(p.license_image_url, p.verification_doc_url),
  coalesce(p.is_verified, false),
  case when coalesce(p.is_verified, false) then 'approved' else 'pending' end,
  coalesce(p.points_balance, p.points, 0)
from public.profiles p
where lower(p.role) = 'supplier'
on conflict (profile_id) do nothing;

insert into public.admin_staff (profile_id, staff_name, role_type, permissions)
select
  p.id,
  coalesce(p.full_name, p.username, split_part(p.email, '@', 1)),
  'super_admin',
  coalesce(
    case
      when jsonb_typeof(p.permissions) = 'array'
        then array(select jsonb_array_elements_text(p.permissions))
      else null
    end,
    array[
      'review_story','manage_supplier','manage_designer',
      'manage_material','manage_user','view_analytics'
    ]
  )
from public.profiles p
where lower(p.role) = 'admin'
on conflict (profile_id) do nothing;

alter table public.designers enable row level security;
alter table public.suppliers enable row level security;
alter table public.admin_staff enable row level security;

drop policy if exists "designers_select_authenticated" on public.designers;
create policy "designers_select_authenticated"
  on public.designers for select to authenticated using (true);

drop policy if exists "designers_update_own" on public.designers;
create policy "designers_update_own"
  on public.designers for update to authenticated
  using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid() or public.is_admin());

drop policy if exists "suppliers_select_authenticated" on public.suppliers;
create policy "suppliers_select_authenticated"
  on public.suppliers for select to authenticated using (true);

drop policy if exists "suppliers_update_own" on public.suppliers;
create policy "suppliers_update_own"
  on public.suppliers for update to authenticated
  using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid() or public.is_admin());

drop policy if exists "admin_staff_admin_all" on public.admin_staff;
create policy "admin_staff_admin_all"
  on public.admin_staff for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ############################################################################
-- 4. Physical DNA — EAV
-- ############################################################################

create table if not exists public.material_physical_genes (
  id uuid primary key default gen_random_uuid(),
  material_id text not null references public.materials(id) on delete cascade,
  category_code text not null references public.categories(category_code) on update cascade,
  attribute_key text not null,
  attribute_value text not null default '',
  attribute_unit text,
  attribute_type text check (attribute_type is null or attribute_type in ('number', 'text')),
  is_preset boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (material_id, attribute_key)
);

create index if not exists material_physical_genes_material_idx
  on public.material_physical_genes(material_id);
create index if not exists material_physical_genes_category_idx
  on public.material_physical_genes(category_code);

drop trigger if exists material_physical_genes_set_updated_at on public.material_physical_genes;
create trigger material_physical_genes_set_updated_at
  before update on public.material_physical_genes
  for each row execute function public.set_updated_at();

comment on table public.material_physical_genes is
  'Physical DNA EAV. Different categories have different keys; NULL-like empty values are normal.';

alter table public.material_physical_genes enable row level security;

drop policy if exists "mpg_select_published_or_owner" on public.material_physical_genes;
create policy "mpg_select_published_or_owner"
  on public.material_physical_genes for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.materials m
      where m.id = material_id
        and (
          m.supplier_id = auth.uid()
          or (m.is_pending = false and m.status in ('published', '已发布'))
        )
    )
  );

drop policy if exists "mpg_supplier_write" on public.material_physical_genes;
create policy "mpg_supplier_write"
  on public.material_physical_genes for all to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.materials m
      where m.id = material_id and m.supplier_id = auth.uid()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.materials m
      where m.id = material_id and m.supplier_id = auth.uid()
    )
  );

-- Preset Physical DNA rows when category_code is set on insert/update
create or replace function public.preset_material_physical_genes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keys jsonb;
  v_units jsonb;
  v_types jsonb;
  v_key text;
  v_i int;
begin
  if new.category_code is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.category_code is not distinct from new.category_code then
    return new;
  end if;

  select attribute_keys, attribute_units, attribute_types
    into v_keys, v_units, v_types
  from public.categories
  where category_code = new.category_code;

  if v_keys is null then
    return new;
  end if;

  for v_i in 0 .. greatest(jsonb_array_length(v_keys) - 1, -1) loop
    v_key := v_keys ->> v_i;
    insert into public.material_physical_genes (
      material_id, category_code, attribute_key,
      attribute_value, attribute_unit, attribute_type, is_preset
    ) values (
      new.id,
      new.category_code,
      v_key,
      '',
      coalesce(v_units ->> v_i, ''),
      coalesce(v_types ->> v_i, 'text'),
      true
    )
    on conflict (material_id, attribute_key) do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists materials_preset_physical_genes on public.materials;
create trigger materials_preset_physical_genes
  after insert or update of category_code on public.materials
  for each row execute function public.preset_material_physical_genes();

-- One-time backfill: existing rows with category_code (UPDATE no-op skips preset trigger)
insert into public.material_physical_genes (
  material_id, category_code, attribute_key,
  attribute_value, attribute_unit, attribute_type, is_preset
)
select
  m.id,
  m.category_code,
  keys.key,
  '',
  coalesce(c.attribute_units ->> (keys.ord - 1), ''),
  coalesce(c.attribute_types ->> (keys.ord - 1), 'text'),
  true
from public.materials m
join public.categories c on c.category_code = m.category_code
cross join lateral jsonb_array_elements_text(c.attribute_keys)
  with ordinality as keys(key, ord)
where m.category_code is not null
on conflict (material_id, attribute_key) do nothing;

-- ############################################################################
-- 5. Media tables (prefer relational over materials arrays)
-- ############################################################################

create table if not exists public.material_gallery (
  id uuid primary key default gen_random_uuid(),
  material_id text not null references public.materials(id) on delete cascade,
  photo_url text not null,
  photo_type text not null default 'product'
    check (photo_type in ('product', 'texture', 'ai_training', 'case', 'application')),
  is_ai_training boolean not null default false,
  is_main boolean not null default false,
  alt_text text,
  width integer,
  height integer,
  uploaded_at timestamptz not null default now()
);

create index if not exists material_gallery_material_idx
  on public.material_gallery(material_id);

create table if not exists public.material_case_photos (
  id uuid primary key default gen_random_uuid(),
  material_id text not null references public.materials(id) on delete cascade,
  project_name text,
  project_location text,
  project_year integer,
  designer_id uuid references public.profiles(id) on delete set null,
  photo_url text not null,
  description text,
  area_used numeric(10,2),
  uploaded_at timestamptz not null default now()
);

create index if not exists material_case_photos_material_idx
  on public.material_case_photos(material_id);

create table if not exists public.material_status_logs (
  id uuid primary key default gen_random_uuid(),
  material_id text not null references public.materials(id) on delete cascade,
  from_status text not null,
  to_status text not null,
  changed_by uuid not null references public.profiles(id) on delete cascade,
  change_reason text,
  ip_address text,
  created_at timestamptz not null default now()
);

create index if not exists material_status_logs_material_idx
  on public.material_status_logs(material_id, created_at desc);

alter table public.material_gallery enable row level security;
alter table public.material_case_photos enable row level security;
alter table public.material_status_logs enable row level security;

drop policy if exists "material_gallery_select" on public.material_gallery;
create policy "material_gallery_select"
  on public.material_gallery for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.materials m
      where m.id = material_id
        and (m.supplier_id = auth.uid()
          or (m.is_pending = false and m.status in ('published', '已发布')))
    )
  );

drop policy if exists "material_gallery_write" on public.material_gallery;
create policy "material_gallery_write"
  on public.material_gallery for all to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.materials m where m.id = material_id and m.supplier_id = auth.uid())
  )
  with check (
    public.is_admin()
    or exists (select 1 from public.materials m where m.id = material_id and m.supplier_id = auth.uid())
  );

drop policy if exists "material_case_photos_select" on public.material_case_photos;
create policy "material_case_photos_select"
  on public.material_case_photos for select to authenticated using (true);

drop policy if exists "material_case_photos_write" on public.material_case_photos;
create policy "material_case_photos_write"
  on public.material_case_photos for all to authenticated
  using (
    public.is_admin()
    or designer_id = auth.uid()
    or exists (select 1 from public.materials m where m.id = material_id and m.supplier_id = auth.uid())
  )
  with check (
    public.is_admin()
    or designer_id = auth.uid()
    or exists (select 1 from public.materials m where m.id = material_id and m.supplier_id = auth.uid())
  );

drop policy if exists "material_status_logs_select" on public.material_status_logs;
create policy "material_status_logs_select"
  on public.material_status_logs for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.materials m where m.id = material_id and m.supplier_id = auth.uid())
  );

drop policy if exists "material_status_logs_insert" on public.material_status_logs;
create policy "material_status_logs_insert"
  on public.material_status_logs for insert to authenticated
  with check (changed_by = auth.uid() or public.is_admin());

-- ############################################################################
-- 6. Emotional DNA — open tag system
-- ############################################################################

create table if not exists public.tag_pool (
  id uuid primary key default gen_random_uuid(),
  tag_word text not null unique,
  dimensions jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'merged', 'hidden')),
  merged_into uuid references public.tag_pool(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tag_dimensions (
  id uuid primary key default gen_random_uuid(),
  dimension_name text not null unique,
  dimension_desc text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.tag_dimension_mappings (
  id uuid primary key default gen_random_uuid(),
  tag_id uuid not null references public.tag_pool(id) on delete cascade,
  dimension_id uuid not null references public.tag_dimensions(id) on delete cascade,
  mapped_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tag_id, dimension_id)
);

create table if not exists public.tag_relationships (
  id uuid primary key default gen_random_uuid(),
  from_tag_id uuid not null references public.tag_pool(id) on delete cascade,
  to_tag_id uuid not null references public.tag_pool(id) on delete cascade,
  relation_type text not null default 'similar'
    check (relation_type in ('similar', 'synonym', 'opposite', 'broader', 'narrower', 'related')),
  weight numeric(4,3) not null default 0.500
    check (weight >= 0 and weight <= 1),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (from_tag_id, to_tag_id, relation_type),
  check (from_tag_id <> to_tag_id)
);

comment on table public.tag_relationships is
  'Emotional DNA graph edges for Tag Embedding / Neo4j export. Empty-capable now.';

create table if not exists public.material_tag_relations (
  id uuid primary key default gen_random_uuid(),
  material_id text not null references public.materials(id) on delete cascade,
  tag_id uuid not null references public.tag_pool(id) on delete cascade,
  tagged_by uuid not null references public.profiles(id) on delete cascade,
  tag_type text not null default 'custom'
    check (tag_type in ('system', 'custom', 'vote')),
  created_at timestamptz not null default now()
);

create index if not exists material_tag_relations_material_idx
  on public.material_tag_relations(material_id, created_at desc);
create index if not exists material_tag_relations_tag_idx
  on public.material_tag_relations(tag_id);
create unique index if not exists material_tag_relations_vote_uidx
  on public.material_tag_relations(material_id, tag_id, tagged_by)
  where tag_type = 'vote';

drop trigger if exists tag_pool_set_updated_at on public.tag_pool;
create trigger tag_pool_set_updated_at
  before update on public.tag_pool
  for each row execute function public.set_updated_at();

alter table public.tag_pool enable row level security;
alter table public.tag_dimensions enable row level security;
alter table public.tag_dimension_mappings enable row level security;
alter table public.tag_relationships enable row level security;
alter table public.material_tag_relations enable row level security;

drop policy if exists "tag_pool_select" on public.tag_pool;
create policy "tag_pool_select"
  on public.tag_pool for select to authenticated
  using (status in ('approved', 'pending') or public.is_admin());

drop policy if exists "tag_pool_insert" on public.tag_pool;
create policy "tag_pool_insert"
  on public.tag_pool for insert to authenticated
  with check (true);

drop policy if exists "tag_pool_admin_update" on public.tag_pool;
create policy "tag_pool_admin_update"
  on public.tag_pool for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "tag_dimensions_select" on public.tag_dimensions;
create policy "tag_dimensions_select"
  on public.tag_dimensions for select to authenticated using (true);

drop policy if exists "tag_dimensions_admin" on public.tag_dimensions;
create policy "tag_dimensions_admin"
  on public.tag_dimensions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "tag_dimension_mappings_select" on public.tag_dimension_mappings;
create policy "tag_dimension_mappings_select"
  on public.tag_dimension_mappings for select to authenticated using (true);

drop policy if exists "tag_dimension_mappings_admin" on public.tag_dimension_mappings;
create policy "tag_dimension_mappings_admin"
  on public.tag_dimension_mappings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "tag_relationships_select" on public.tag_relationships;
create policy "tag_relationships_select"
  on public.tag_relationships for select to authenticated using (true);

drop policy if exists "tag_relationships_admin" on public.tag_relationships;
create policy "tag_relationships_admin"
  on public.tag_relationships for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "material_tag_relations_select" on public.material_tag_relations;
create policy "material_tag_relations_select"
  on public.material_tag_relations for select to authenticated using (true);

drop policy if exists "material_tag_relations_insert" on public.material_tag_relations;
create policy "material_tag_relations_insert"
  on public.material_tag_relations for insert to authenticated
  with check (tagged_by = auth.uid());

drop policy if exists "material_tag_relations_delete_own" on public.material_tag_relations;
create policy "material_tag_relations_delete_own"
  on public.material_tag_relations for delete to authenticated
  using (tagged_by = auth.uid() or public.is_admin());

-- Seed a few Emotional DNA dimensions (extensible)
insert into public.tag_dimensions (dimension_name, dimension_desc, sort_order) values
  ('style', '风格意象', 1),
  ('emotion', '情绪感受', 2),
  ('texture_feel', '触感/质感', 3),
  ('memory', '记忆联想', 4),
  ('luxury', '奢华/克制', 5),
  ('temperature', '冷暖感知', 6)
on conflict (dimension_name) do nothing;

-- ############################################################################
-- 7. Content bridges (moodboards / stories already exist)
-- ############################################################################

create table if not exists public.moodboard_materials (
  id uuid primary key default gen_random_uuid(),
  moodboard_id text not null references public.moodboards(id) on delete cascade,
  material_id text not null references public.materials(id) on delete cascade,
  position_order integer not null default 0,
  role_in_board text check (role_in_board is null or role_in_board in ('primary', 'accent', 'background')),
  notes text,
  added_at timestamptz not null default now(),
  unique (moodboard_id, material_id)
);

create index if not exists moodboard_materials_material_idx
  on public.moodboard_materials(material_id);

-- Evolve existing inspiration stories (additive)
alter table public.material_inspiration_stories
  add column if not exists title text,
  add column if not exists project_year integer,
  add column if not exists area_used numeric(10,2),
  add column if not exists images text[] not null default '{}',
  add column if not exists report_count integer not null default 0,
  add column if not exists report_reason text,
  add column if not exists reported_at timestamptz,
  add column if not exists review_notes text,
  add column if not exists updated_at timestamptz not null default now();

-- Expand story status for reported workflow (keep pending/approved/rejected)
alter table public.material_inspiration_stories
  drop constraint if exists material_inspiration_stories_status_check;
alter table public.material_inspiration_stories
  add constraint material_inspiration_stories_status_check
  check (status in ('pending', 'pending_review', 'approved', 'published', 'rejected', 'reported'));

-- Relax min length toward handbook (>=50 preferred at app layer; DB keep >=12 for legacy)
-- (left as-is from 021)

create table if not exists public.story_materials (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.material_inspiration_stories(id) on delete cascade,
  material_id text not null references public.materials(id) on delete cascade,
  usage_description text,
  area_used numeric(10,2),
  added_at timestamptz not null default now(),
  unique (story_id, material_id)
);

-- Backfill story_materials from single-material stories
insert into public.story_materials (story_id, material_id, area_used)
select s.id, s.material_id, s.area_used
from public.material_inspiration_stories s
on conflict (story_id, material_id) do nothing;

alter table public.moodboard_materials enable row level security;
alter table public.story_materials enable row level security;

drop policy if exists "moodboard_materials_select" on public.moodboard_materials;
create policy "moodboard_materials_select"
  on public.moodboard_materials for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.moodboards b
      where b.id = moodboard_id
        and (b.user_id = auth.uid() or b.is_published = true or b.visibility = 'public')
    )
  );

drop policy if exists "moodboard_materials_write" on public.moodboard_materials;
create policy "moodboard_materials_write"
  on public.moodboard_materials for all to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.moodboards b where b.id = moodboard_id and b.user_id = auth.uid())
  )
  with check (
    public.is_admin()
    or exists (select 1 from public.moodboards b where b.id = moodboard_id and b.user_id = auth.uid())
  );

drop policy if exists "story_materials_select" on public.story_materials;
create policy "story_materials_select"
  on public.story_materials for select to authenticated using (true);

drop policy if exists "story_materials_write" on public.story_materials;
create policy "story_materials_write"
  on public.story_materials for all to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.material_inspiration_stories s
      where s.id = story_id and s.author_id = auth.uid()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.material_inspiration_stories s
      where s.id = story_id and s.author_id = auth.uid()
    )
  );

-- ############################################################################
-- 8. Behavior — user_events + social state tables
-- ############################################################################

create table if not exists public.user_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint user_events_type_check check (event_type in (
    'browse_material', 'like_material', 'favorite_material', 'share_material',
    'create_moodboard', 'publish_moodboard', 'moodboard_favorited',
    'follow_user', 'unfollow_user', 'use_ai_identify',
    'apply_sample', 'apply_quotation', 'adopt_quotation',
    'write_review', 'add_tag', 'vote_tag',
    'write_story', 'story_reported', 'recharge_points',
    'evaluate_material', 'moodboard_use_material'
  ))
);

comment on table public.user_events is
  'Append-only user behavior stream. Does NOT mutate material Physical/Emotional DNA.';

create index if not exists user_events_user_created_idx
  on public.user_events(user_id, created_at desc);
create index if not exists user_events_type_created_idx
  on public.user_events(event_type, created_at desc);
create index if not exists user_events_target_idx
  on public.user_events(target_type, target_id, created_at desc);

alter table public.user_events enable row level security;

drop policy if exists "user_events_insert_own" on public.user_events;
create policy "user_events_insert_own"
  on public.user_events for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_events_select_own" on public.user_events;
create policy "user_events_select_own"
  on public.user_events for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- No UPDATE/DELETE policies — append-only by design

create or replace function public.log_user_event(
  p_event_type text,
  p_target_type text default null,
  p_target_id text default null,
  p_metadata jsonb default '{}'::jsonb
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

  insert into public.user_events (event_type, user_id, target_type, target_id, metadata)
  values (p_event_type, v_uid, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.log_user_event(text, text, text, jsonb) to authenticated;

-- Polymorphic social state (saved_materials remains for legacy material favorites)
create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('material', 'story', 'moodboard')),
  target_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, target_type, target_id)
);

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('material', 'story', 'comment')),
  target_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, target_type, target_id)
);

create table if not exists public.follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('material', 'story', 'comment')),
  target_id text not null,
  parent_comment_id uuid references public.comments(id) on delete cascade,
  content text not null,
  likes_count integer not null default 0,
  status text not null default 'published'
    check (status in ('published', 'hidden', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('material', 'story', 'moodboard')),
  target_id text not null,
  share_channel text not null
    check (share_channel in ('wechat', 'weibo', 'copy_link', 'qr_code')),
  share_url text not null,
  qr_code_url text,
  created_at timestamptz not null default now()
);

drop trigger if exists comments_set_updated_at on public.comments;
create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

-- Backfill favorites from saved_materials / saved_moodboards
insert into public.favorites (user_id, target_type, target_id, created_at)
select user_id, 'material', material_id, created_at
from public.saved_materials
on conflict (user_id, target_type, target_id) do nothing;

insert into public.favorites (user_id, target_type, target_id, created_at)
select user_id, 'moodboard', moodboard_id, created_at
from public.saved_moodboards
on conflict (user_id, target_type, target_id) do nothing;

alter table public.favorites enable row level security;
alter table public.likes enable row level security;
alter table public.follows enable row level security;
alter table public.comments enable row level security;
alter table public.shares enable row level security;

drop policy if exists "favorites_own" on public.favorites;
create policy "favorites_own"
  on public.favorites for all to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid());

drop policy if exists "likes_own" on public.likes;
create policy "likes_own"
  on public.likes for all to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid());

drop policy if exists "follows_select" on public.follows;
create policy "follows_select"
  on public.follows for select to authenticated using (true);

drop policy if exists "follows_write_own" on public.follows;
create policy "follows_write_own"
  on public.follows for all to authenticated
  using (follower_id = auth.uid() or public.is_admin())
  with check (follower_id = auth.uid());

drop policy if exists "comments_select" on public.comments;
create policy "comments_select"
  on public.comments for select to authenticated
  using (status = 'published' or user_id = auth.uid() or public.is_admin());

drop policy if exists "comments_insert" on public.comments;
create policy "comments_insert"
  on public.comments for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "comments_update_own" on public.comments;
create policy "comments_update_own"
  on public.comments for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "shares_own" on public.shares;
create policy "shares_own"
  on public.shares for all to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid());

-- ############################################################################
-- 9. Commerce / ops
-- ############################################################################

create table if not exists public.sample_requests (
  id uuid primary key default gen_random_uuid(),
  designer_id uuid not null references public.profiles(id) on delete cascade,
  supplier_id uuid not null references public.profiles(id) on delete cascade,
  material_id text not null references public.materials(id) on delete cascade,
  project_info text,
  quantity text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'shipped', 'completed')),
  tracking_number text,
  points_cost integer not null default 20,
  feedback text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotation_requests (
  id uuid primary key default gen_random_uuid(),
  designer_id uuid not null references public.profiles(id) on delete cascade,
  supplier_id uuid not null references public.profiles(id) on delete cascade,
  material_id text not null references public.materials(id) on delete cascade,
  quantity text,
  status text not null default 'pending'
    check (status in ('pending', 'quoted', 'rejected', 'adopted')),
  quote_price text,
  quote_valid_until date,
  quote_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.points_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  transaction_type text not null
    check (transaction_type in ('recharge', 'consume', 'gift', 'refund')),
  amount integer not null,
  balance_after integer,
  description text,
  payment_method text,
  payment_amount numeric(12,2),
  payment_currency text not null default 'CNY',
  payment_status text not null default 'completed'
    check (payment_status in ('pending', 'completed', 'failed', 'refunded', 'success')),
  order_no text,
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_verifications (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.profiles(id) on delete cascade,
  company_name text not null,
  license_image_url text,
  phone text not null,
  email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.audits (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('material', 'story', 'supplier', 'tag')),
  target_id text not null,
  submitter_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'revision_requested')),
  reviewer_id uuid references public.profiles(id) on delete set null,
  review_comment text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles(id) on delete cascade,
  action_type text not null,
  target_type text,
  target_id text,
  details text,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  notification_type text not null,
  title text not null,
  content text not null,
  related_type text,
  related_id text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.user_storage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  file_type text not null,
  file_url text not null,
  file_size_bytes bigint not null,
  action text not null check (action in ('upload', 'delete', 'update')),
  related_resource_type text,
  related_resource_id text,
  created_at timestamptz not null default now()
);

drop trigger if exists sample_requests_set_updated_at on public.sample_requests;
create trigger sample_requests_set_updated_at
  before update on public.sample_requests
  for each row execute function public.set_updated_at();

drop trigger if exists quotation_requests_set_updated_at on public.quotation_requests;
create trigger quotation_requests_set_updated_at
  before update on public.quotation_requests
  for each row execute function public.set_updated_at();

drop trigger if exists audits_set_updated_at on public.audits;
create trigger audits_set_updated_at
  before update on public.audits
  for each row execute function public.set_updated_at();

alter table public.sample_requests enable row level security;
alter table public.quotation_requests enable row level security;
alter table public.points_transactions enable row level security;
alter table public.supplier_verifications enable row level security;
alter table public.audits enable row level security;
alter table public.admin_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.user_storage_logs enable row level security;

drop policy if exists "sample_requests_parties" on public.sample_requests;
create policy "sample_requests_parties"
  on public.sample_requests for all to authenticated
  using (designer_id = auth.uid() or supplier_id = auth.uid() or public.is_admin())
  with check (designer_id = auth.uid() or public.is_admin());

drop policy if exists "quotation_requests_parties" on public.quotation_requests;
create policy "quotation_requests_parties"
  on public.quotation_requests for all to authenticated
  using (designer_id = auth.uid() or supplier_id = auth.uid() or public.is_admin())
  with check (designer_id = auth.uid() or public.is_admin());

drop policy if exists "points_transactions_own" on public.points_transactions;
create policy "points_transactions_own"
  on public.points_transactions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "points_transactions_insert_own" on public.points_transactions;
create policy "points_transactions_insert_own"
  on public.points_transactions for insert to authenticated
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "supplier_verifications_own" on public.supplier_verifications;
create policy "supplier_verifications_own"
  on public.supplier_verifications for select to authenticated
  using (supplier_id = auth.uid() or public.is_admin());

drop policy if exists "supplier_verifications_insert" on public.supplier_verifications;
create policy "supplier_verifications_insert"
  on public.supplier_verifications for insert to authenticated
  with check (supplier_id = auth.uid());

drop policy if exists "supplier_verifications_admin_update" on public.supplier_verifications;
create policy "supplier_verifications_admin_update"
  on public.supplier_verifications for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "audits_select" on public.audits;
create policy "audits_select"
  on public.audits for select to authenticated
  using (submitter_id = auth.uid() or public.is_admin());

drop policy if exists "audits_insert" on public.audits;
create policy "audits_insert"
  on public.audits for insert to authenticated
  with check (submitter_id = auth.uid());

drop policy if exists "audits_admin_update" on public.audits;
create policy "audits_admin_update"
  on public.audits for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_logs_admin" on public.admin_logs;
create policy "admin_logs_admin"
  on public.admin_logs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "notifications_own" on public.notifications;
create policy "notifications_own"
  on public.notifications for all to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "user_storage_logs_own" on public.user_storage_logs;
create policy "user_storage_logs_own"
  on public.user_storage_logs for all to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- ############################################################################
-- 10. AI interfaces — entity_embeddings + kg_sync_outbox (NO vector column)
-- ############################################################################

create table if not exists public.entity_embeddings (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null
    check (entity_type in (
      'material', 'tag', 'designer_profile', 'supplier_profile'
    )),
  entity_id text not null,
  embedding_status text not null default 'pending'
    check (embedding_status in ('pending', 'ready', 'stale', 'failed', 'disabled')),
  model_name text,
  source_fingerprint text,
  source_version integer not null default 1,
  dims integer,
  -- Future: add `embedding vector(N)` in a dedicated pgvector migration
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_id)
);

comment on table public.entity_embeddings is
  'Embedding metadata registry. No vector column yet — reserved for future pgvector.';

create index if not exists entity_embeddings_status_idx
  on public.entity_embeddings(embedding_status, updated_at desc);

drop trigger if exists entity_embeddings_set_updated_at on public.entity_embeddings;
create trigger entity_embeddings_set_updated_at
  before update on public.entity_embeddings
  for each row execute function public.set_updated_at();

create table if not exists public.kg_sync_outbox (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  op text not null check (op in ('upsert', 'delete', 'relate', 'unrelate')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed', 'dead')),
  attempts integer not null default 0,
  last_error text,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.kg_sync_outbox is
  'Change-data outbox for future Neo4j / RAG consumers. Trigger framework enqueues here.';

create index if not exists kg_sync_outbox_pending_idx
  on public.kg_sync_outbox(status, available_at)
  where status in ('pending', 'failed');

alter table public.entity_embeddings enable row level security;
alter table public.kg_sync_outbox enable row level security;

drop policy if exists "entity_embeddings_admin" on public.entity_embeddings;
create policy "entity_embeddings_admin"
  on public.entity_embeddings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "entity_embeddings_select_own_profile" on public.entity_embeddings;
create policy "entity_embeddings_select_own_profile"
  on public.entity_embeddings for select to authenticated
  using (
    (entity_type in ('designer_profile', 'supplier_profile') and entity_id = auth.uid()::text)
    or public.is_admin()
  );

drop policy if exists "kg_sync_outbox_admin" on public.kg_sync_outbox;
create policy "kg_sync_outbox_admin"
  on public.kg_sync_outbox for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Service role / security definer writers enqueue; clients do not insert outbox directly.

-- ############################################################################
-- 11. Trigger framework — outbox + embedding stale (ready for Edge Functions)
-- ############################################################################

create or replace function public.enqueue_kg_sync(
  p_entity_type text,
  p_entity_id text,
  p_op text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.kg_sync_outbox (entity_type, entity_id, op, payload)
  values (p_entity_type, p_entity_id, p_op, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.mark_entity_embedding_stale(
  p_entity_type text,
  p_entity_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.entity_embeddings (entity_type, entity_id, embedding_status)
  values (p_entity_type, p_entity_id, 'stale')
  on conflict (entity_type, entity_id) do update
    set embedding_status = case
          when public.entity_embeddings.embedding_status = 'disabled' then 'disabled'
          else 'stale'
        end,
        updated_at = now(),
        source_version = public.entity_embeddings.source_version + 1;
end;
$$;

-- Generic AFTER trigger: materials catalog changes
create or replace function public.trg_materials_ai_hooks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.enqueue_kg_sync('material', old.id, 'delete', jsonb_build_object('id', old.id));
    perform public.mark_entity_embedding_stale('material', old.id);
    return old;
  end if;

  -- Skip AI hooks when only moodboard_count counter changes (avoids outbox storms)
  if tg_op = 'UPDATE'
     and old.moodboard_count is distinct from new.moodboard_count
     and old.category_code is not distinct from new.category_code
     and old.status is not distinct from new.status
     and old.name is not distinct from new.name
     and old.brand is not distinct from new.brand
     and old.description is not distinct from new.description
     and old.cover_image_url is not distinct from new.cover_image_url
     and old.data is not distinct from new.data
     and old.hard_specs is not distinct from new.hard_specs
     and old.soft_specs is not distinct from new.soft_specs
     and old.official_mood_tags is not distinct from new.official_mood_tags
  then
    return new;
  end if;

  perform public.enqueue_kg_sync(
    'material',
    new.id,
    'upsert',
    jsonb_build_object(
      'id', new.id,
      'category_code', new.category_code,
      'status', new.status,
      'supplier_id', new.supplier_id
    )
  );
  perform public.mark_entity_embedding_stale('material', new.id);

  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into public.material_status_logs (
      material_id, from_status, to_status, changed_by, change_reason
    ) values (
      new.id,
      coalesce(old.status, ''),
      new.status,
      coalesce(auth.uid(), new.supplier_id),
      'status_change_trigger'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists materials_ai_hooks on public.materials;
create trigger materials_ai_hooks
  after insert or update or delete on public.materials
  for each row execute function public.trg_materials_ai_hooks();

create or replace function public.trg_physical_genes_ai_hooks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid text;
begin
  v_mid := coalesce(new.material_id, old.material_id);
  perform public.enqueue_kg_sync(
    'material_physical_gene',
    coalesce(new.id::text, old.id::text),
    case when tg_op = 'DELETE' then 'delete' else 'upsert' end,
    jsonb_build_object('material_id', v_mid, 'attribute_key', coalesce(new.attribute_key, old.attribute_key))
  );
  perform public.mark_entity_embedding_stale('material', v_mid);
  return coalesce(new, old);
end;
$$;

drop trigger if exists material_physical_genes_ai_hooks on public.material_physical_genes;
create trigger material_physical_genes_ai_hooks
  after insert or update or delete on public.material_physical_genes
  for each row execute function public.trg_physical_genes_ai_hooks();

create or replace function public.trg_tag_pool_ai_hooks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.enqueue_kg_sync('tag', old.id::text, 'delete', jsonb_build_object('tag_word', old.tag_word));
    perform public.mark_entity_embedding_stale('tag', old.id::text);
    return old;
  end if;
  perform public.enqueue_kg_sync(
    'tag', new.id::text, 'upsert',
    jsonb_build_object('tag_word', new.tag_word, 'status', new.status, 'dimensions', new.dimensions)
  );
  perform public.mark_entity_embedding_stale('tag', new.id::text);
  return new;
end;
$$;

drop trigger if exists tag_pool_ai_hooks on public.tag_pool;
create trigger tag_pool_ai_hooks
  after insert or update or delete on public.tag_pool
  for each row execute function public.trg_tag_pool_ai_hooks();

create or replace function public.trg_tag_relationships_ai_hooks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.enqueue_kg_sync(
      'tag_relationship', old.id::text, 'unrelate',
      jsonb_build_object('from', old.from_tag_id, 'to', old.to_tag_id, 'type', old.relation_type)
    );
    perform public.mark_entity_embedding_stale('tag', old.from_tag_id::text);
    perform public.mark_entity_embedding_stale('tag', old.to_tag_id::text);
    return old;
  end if;
  perform public.enqueue_kg_sync(
    'tag_relationship', new.id::text, 'relate',
    jsonb_build_object(
      'from', new.from_tag_id, 'to', new.to_tag_id,
      'type', new.relation_type, 'weight', new.weight
    )
  );
  perform public.mark_entity_embedding_stale('tag', new.from_tag_id::text);
  perform public.mark_entity_embedding_stale('tag', new.to_tag_id::text);
  return new;
end;
$$;

drop trigger if exists tag_relationships_ai_hooks on public.tag_relationships;
create trigger tag_relationships_ai_hooks
  after insert or update or delete on public.tag_relationships
  for each row execute function public.trg_tag_relationships_ai_hooks();

create or replace function public.trg_material_tag_relations_ai_hooks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid text;
  v_tid uuid;
begin
  v_mid := coalesce(new.material_id, old.material_id);
  v_tid := coalesce(new.tag_id, old.tag_id);
  perform public.enqueue_kg_sync(
    'material_tag',
    coalesce(new.id::text, old.id::text),
    case when tg_op = 'DELETE' then 'unrelate' else 'relate' end,
    jsonb_build_object('material_id', v_mid, 'tag_id', v_tid)
  );
  perform public.mark_entity_embedding_stale('material', v_mid);
  perform public.mark_entity_embedding_stale('tag', v_tid::text);
  return coalesce(new, old);
end;
$$;

drop trigger if exists material_tag_relations_ai_hooks on public.material_tag_relations;
create trigger material_tag_relations_ai_hooks
  after insert or update or delete on public.material_tag_relations
  for each row execute function public.trg_material_tag_relations_ai_hooks();

create or replace function public.trg_story_ai_hooks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.enqueue_kg_sync('story', old.id::text, 'delete', '{}'::jsonb);
    if old.material_id is not null then
      perform public.mark_entity_embedding_stale('material', old.material_id);
    end if;
    perform public.mark_entity_embedding_stale('designer_profile', old.author_id::text);
    return old;
  end if;
  perform public.enqueue_kg_sync(
    'story', new.id::text, 'upsert',
    jsonb_build_object('material_id', new.material_id, 'author_id', new.author_id, 'status', new.status)
  );
  if new.material_id is not null then
    perform public.mark_entity_embedding_stale('material', new.material_id);
  end if;
  perform public.mark_entity_embedding_stale('designer_profile', new.author_id::text);
  return new;
end;
$$;

drop trigger if exists material_inspiration_stories_ai_hooks on public.material_inspiration_stories;
create trigger material_inspiration_stories_ai_hooks
  after insert or update or delete on public.material_inspiration_stories
  for each row execute function public.trg_story_ai_hooks();

create or replace function public.trg_moodboard_materials_ai_hooks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mid text;
  v_bid text;
  v_owner uuid;
begin
  v_mid := coalesce(new.material_id, old.material_id);
  v_bid := coalesce(new.moodboard_id, old.moodboard_id);
  select user_id into v_owner from public.moodboards where id = v_bid;

  perform public.enqueue_kg_sync(
    'moodboard_material',
    coalesce(new.id::text, old.id::text),
    case when tg_op = 'DELETE' then 'unrelate' else 'relate' end,
    jsonb_build_object('moodboard_id', v_bid, 'material_id', v_mid)
  );
  perform public.mark_entity_embedding_stale('material', v_mid);
  if v_owner is not null then
    perform public.mark_entity_embedding_stale('designer_profile', v_owner::text);
  end if;

  if tg_op = 'INSERT' then
    update public.materials set moodboard_count = moodboard_count + 1 where id = v_mid;
  elsif tg_op = 'DELETE' then
    update public.materials
      set moodboard_count = greatest(moodboard_count - 1, 0)
    where id = v_mid;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists moodboard_materials_ai_hooks on public.moodboard_materials;
create trigger moodboard_materials_ai_hooks
  after insert or delete on public.moodboard_materials
  for each row execute function public.trg_moodboard_materials_ai_hooks();

create or replace function public.trg_profiles_ai_hooks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_etype text;
begin
  if lower(coalesce(new.role, old.role)) = 'designer' then
    v_etype := 'designer_profile';
  elsif lower(coalesce(new.role, old.role)) = 'supplier' then
    v_etype := 'supplier_profile';
  else
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    perform public.enqueue_kg_sync(v_etype, old.id::text, 'delete', '{}'::jsonb);
    perform public.mark_entity_embedding_stale(v_etype, old.id::text);
    return old;
  end if;

  perform public.enqueue_kg_sync(
    v_etype, new.id::text, 'upsert',
    jsonb_build_object('role', new.role, 'email', new.email)
  );
  perform public.mark_entity_embedding_stale(v_etype, new.id::text);
  return new;
end;
$$;

drop trigger if exists profiles_ai_hooks on public.profiles;
create trigger profiles_ai_hooks
  after insert or update or delete on public.profiles
  for each row execute function public.trg_profiles_ai_hooks();

-- Mirror social mutations into user_events (behavior) without touching material DNA
create or replace function public.trg_favorites_user_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.target_type = 'material' then
    insert into public.user_events (event_type, user_id, target_type, target_id)
    values ('favorite_material', new.user_id, 'material', new.target_id);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists favorites_user_event on public.favorites;
create trigger favorites_user_event
  after insert on public.favorites
  for each row execute function public.trg_favorites_user_event();

create or replace function public.trg_likes_user_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.target_type = 'material' then
    insert into public.user_events (event_type, user_id, target_type, target_id)
    values ('like_material', new.user_id, 'material', new.target_id);
  end if;
  return new;
end;
$$;

drop trigger if exists likes_user_event on public.likes;
create trigger likes_user_event
  after insert on public.likes
  for each row execute function public.trg_likes_user_event();

create or replace function public.trg_follows_user_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.user_events (event_type, user_id, target_type, target_id)
    values ('follow_user', new.follower_id, 'user', new.followee_id::text);
  elsif tg_op = 'DELETE' then
    insert into public.user_events (event_type, user_id, target_type, target_id)
    values ('unfollow_user', old.follower_id, 'user', old.followee_id::text);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists follows_user_event on public.follows;
create trigger follows_user_event
  after insert or delete on public.follows
  for each row execute function public.trg_follows_user_event();

-- Ensure entity_embeddings placeholder rows exist for current profiles/materials (status=pending)
insert into public.entity_embeddings (entity_type, entity_id, embedding_status)
select 'material', m.id, 'pending' from public.materials m
on conflict (entity_type, entity_id) do nothing;

insert into public.entity_embeddings (entity_type, entity_id, embedding_status)
select 'designer_profile', p.id::text, 'pending'
from public.profiles p where lower(p.role) = 'designer'
on conflict (entity_type, entity_id) do nothing;

insert into public.entity_embeddings (entity_type, entity_id, embedding_status)
select 'supplier_profile', p.id::text, 'pending'
from public.profiles p where lower(p.role) = 'supplier'
on conflict (entity_type, entity_id) do nothing;

-- ############################################################################
-- 12. Grants (authenticated)
-- ############################################################################

grant select, insert, update, delete on
  public.designers,
  public.suppliers,
  public.material_physical_genes,
  public.material_gallery,
  public.material_case_photos,
  public.material_status_logs,
  public.tag_pool,
  public.tag_dimensions,
  public.tag_dimension_mappings,
  public.tag_relationships,
  public.material_tag_relations,
  public.moodboard_materials,
  public.story_materials,
  public.user_events,
  public.favorites,
  public.likes,
  public.follows,
  public.comments,
  public.shares,
  public.sample_requests,
  public.quotation_requests,
  public.points_transactions,
  public.supplier_verifications,
  public.audits,
  public.notifications,
  public.user_storage_logs
to authenticated;

grant select, insert, update, delete on public.admin_staff to authenticated;
grant select on public.entity_embeddings to authenticated;
grant select, insert on public.admin_logs to authenticated;
grant select on public.kg_sync_outbox to authenticated;
-- kg_sync_outbox writes go through security definer enqueue_kg_sync(); RLS keeps client writes admin-only.

comment on schema public is
  'MatterInsight shared schema for Designer/Supplier/Admin. AI vector/Neo4j not enabled; outbox+embeddings ready.';
