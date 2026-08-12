-- Matter Insight — bilingual official mood tags (parallel jsonb; keep text[] for compat)
-- Does NOT alter materials.data column type; bilingual catalog fields live inside data JSON.

alter table public.materials
  add column if not exists official_mood_tags_i18n jsonb not null default '[]'::jsonb;

comment on column public.materials.official_mood_tags_i18n is
  'Bilingual official brand mood tags: JSON array of { "zh": "...", "en": "..." }. Parallel to official_mood_tags text[].';

alter table public.materials
  drop constraint if exists materials_official_mood_tags_i18n_max_3;

alter table public.materials
  add constraint materials_official_mood_tags_i18n_max_3
  check (
    jsonb_typeof(official_mood_tags_i18n) = 'array'
    and jsonb_array_length(official_mood_tags_i18n) <= 3
  );

-- Backfill from legacy text[] (zh only) when i18n empty
update public.materials m
set official_mood_tags_i18n = coalesce(
  (
    select jsonb_agg(jsonb_build_object('zh', t, 'en', ''))
    from unnest(m.official_mood_tags) as t
  ),
  '[]'::jsonb
)
where jsonb_array_length(coalesce(m.official_mood_tags_i18n, '[]'::jsonb)) = 0
  and cardinality(coalesce(m.official_mood_tags, '{}'::text[])) > 0;
