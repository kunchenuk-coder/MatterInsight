-- Heal materials.data.humanDna so detail page never gets undefined arrays/objects.
-- Applied remotely via Supabase MCP as heal_incomplete_material_humandna.

UPDATE public.materials m
SET
  data = coalesce(m.data, '{}'::jsonb) || jsonb_build_object(
    'humanDna',
    jsonb_build_object(
      'ai_trained_status',
        coalesce((m.data->'humanDna'->>'ai_trained_status')::boolean, false),
      'application_cases',
        CASE
          WHEN jsonb_typeof(m.data->'humanDna'->'application_cases') = 'array'
            THEN m.data->'humanDna'->'application_cases'
          ELSE '[]'::jsonb
        END,
      'evaluations',
        CASE
          WHEN jsonb_typeof(m.data->'humanDna'->'evaluations') = 'object'
            THEN (
              jsonb_build_object(
                'durability', 4.0,
                'service', 4.0,
                'aesthetics', 4.0,
                'cleanliness', 4.0,
                'recommendation', 4.0
              ) || (m.data->'humanDna'->'evaluations')
            )
          ELSE jsonb_build_object(
            'durability', 4.0,
            'service', 4.0,
            'aesthetics', 4.0,
            'cleanliness', 4.0,
            'recommendation', 4.0
          )
        END,
      'mood_tags',
        CASE
          WHEN jsonb_typeof(m.data->'humanDna'->'mood_tags') = 'array'
            THEN m.data->'humanDna'->'mood_tags'
          ELSE '[]'::jsonb
        END,
      'inspiration_stories',
        CASE
          WHEN jsonb_typeof(m.data->'humanDna'->'inspiration_stories') = 'array'
            THEN m.data->'humanDna'->'inspiration_stories'
          ELSE '[]'::jsonb
        END,
      'evaluation_vote_count',
        coalesce(
          nullif(m.data->'humanDna'->>'evaluation_vote_count', '')::integer,
          0
        )
    )
  ),
  official_mood_tags = COALESCE((
    SELECT array_agg(x.tag ORDER BY x.ord)
    FROM (
      SELECT e.value->>'tag' AS tag, ord
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(m.data->'humanDna'->'mood_tags') = 'array'
            THEN m.data->'humanDna'->'mood_tags'
          ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY AS e(value, ord)
      WHERE coalesce((e.value->>'is_brand_official')::boolean, false)
      LIMIT 3
    ) x
  ), '{}'::text[]),
  updated_at = now()
WHERE not (m.data ? 'humanDna')
   OR m.data->'humanDna' IS NULL
   OR jsonb_typeof(m.data->'humanDna') <> 'object'
   OR not ((m.data->'humanDna') ? 'evaluations')
   OR not ((m.data->'humanDna') ? 'application_cases')
   OR not ((m.data->'humanDna') ? 'inspiration_stories')
   OR not ((m.data->'humanDna') ? 'mood_tags')
   OR jsonb_typeof(m.data->'humanDna'->'mood_tags') IS DISTINCT FROM 'array'
   OR jsonb_typeof(m.data->'humanDna'->'application_cases') IS DISTINCT FROM 'array'
   OR jsonb_typeof(m.data->'humanDna'->'inspiration_stories') IS DISTINCT FROM 'array'
   OR jsonb_typeof(m.data->'humanDna'->'evaluations') IS DISTINCT FROM 'object';
