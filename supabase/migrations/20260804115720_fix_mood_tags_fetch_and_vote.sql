-- Fetch mood tags for material detail (humanDna + material_tag_relation fallback)
-- + vote_material_mood_tag RPC used by designer +1

CREATE OR REPLACE FUNCTION public.list_material_mood_tags(p_material_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_embedded jsonb;
  v_from_rel jsonb := '[]'::jsonb;
BEGIN
  IF p_material_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT coalesce(data->'humanDna'->'mood_tags', '[]'::jsonb)
  INTO v_embedded
  FROM public.materials
  WHERE id = p_material_id;

  IF v_embedded IS NOT NULL AND jsonb_typeof(v_embedded) = 'array' AND jsonb_array_length(v_embedded) > 0 THEN
    RETURN v_embedded;
  END IF;

  -- Rebuild from relation table when humanDna was wiped / never written
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'tag', x.tag_word,
        'count', x.vote_count,
        'is_brand_official', x.is_brand,
        'is_custom', NOT x.is_brand
      )
      ORDER BY x.is_brand DESC, x.vote_count DESC, x.tag_word
    ),
    '[]'::jsonb
  )
  INTO v_from_rel
  FROM (
    SELECT
      tp.tag_word,
      bool_or(mtr.tag_type IN ('官方标签', 'brand', 'system')) AS is_brand,
      count(*)::int AS vote_count
    FROM public.material_tag_relation mtr
    JOIN public.tag_pool tp ON tp.id = mtr.tag_id
    WHERE mtr.material_id::text = p_material_id::text
    GROUP BY tp.tag_word
  ) x;

  -- Best-effort heal humanDna so subsequent reads stay fast
  IF jsonb_array_length(v_from_rel) > 0 THEN
    UPDATE public.materials
    SET
      data = coalesce(data, '{}'::jsonb)
        || jsonb_build_object(
          'humanDna',
          coalesce(data->'humanDna', '{}'::jsonb)
            || jsonb_build_object('mood_tags', v_from_rel)
        ),
      updated_at = now()
    WHERE id = p_material_id
      AND (
        data->'humanDna'->'mood_tags' IS NULL
        OR jsonb_array_length(coalesce(data->'humanDna'->'mood_tags', '[]'::jsonb)) = 0
      );
  END IF;

  RETURN v_from_rel;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_material_mood_tags(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_material_mood_tags(uuid) TO anon;

CREATE OR REPLACE FUNCTION public.vote_material_mood_tag(
  p_material_id uuid,
  p_tag_word text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_tag text := trim(coalesce(p_tag_word, ''));
  v_tag_id uuid;
  v_data jsonb;
  v_human jsonb;
  v_tags jsonb;
  v_found boolean := false;
  v_elem jsonb;
  v_next jsonb := '[]'::jsonb;
  v_i int;
  v_len int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF char_length(v_tag) < 1 THEN
    RAISE EXCEPTION 'tag required';
  END IF;

  SELECT lower(role) INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role IS DISTINCT FROM 'designer' THEN
    RAISE EXCEPTION 'only designers may vote mood tags';
  END IF;

  SELECT id INTO v_tag_id FROM public.tag_pool WHERE tag_word = v_tag LIMIT 1;
  IF v_tag_id IS NULL THEN
    INSERT INTO public.tag_pool (tag_word, dimensions, status, created_at)
    VALUES (v_tag, '{}'::jsonb, 'approved', now())
    ON CONFLICT (tag_word) DO UPDATE SET tag_word = excluded.tag_word
    RETURNING id INTO v_tag_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.material_tag_relation
    WHERE material_id::text = p_material_id::text
      AND tag_id = v_tag_id
      AND tagged_by = v_uid
  ) THEN
    INSERT INTO public.material_tag_relation (material_id, tag_id, tagged_by, tag_type, created_at)
    VALUES (p_material_id, v_tag_id, v_uid, '自定义标签', now());
  END IF;

  SELECT data INTO v_data FROM public.materials WHERE id = p_material_id FOR UPDATE;
  IF v_data IS NULL THEN
    RAISE EXCEPTION 'material not found';
  END IF;

  v_human := coalesce(v_data->'humanDna', '{}'::jsonb);
  v_tags := coalesce(v_human->'mood_tags', '[]'::jsonb);
  v_len := jsonb_array_length(v_tags);

  FOR v_i IN 0 .. greatest(v_len - 1, -1) LOOP
    v_elem := v_tags->v_i;
    IF lower(v_elem->>'tag') = lower(v_tag) THEN
      v_found := true;
      v_elem := v_elem || jsonb_build_object(
        'count', coalesce((v_elem->>'count')::int, 0) + 1
      );
    END IF;
    v_next := v_next || jsonb_build_array(v_elem);
  END LOOP;

  IF NOT v_found THEN
    v_next := v_next || jsonb_build_array(jsonb_build_object(
      'tag', v_tag,
      'count', 1,
      'is_custom', false
    ));
  END IF;

  v_human := v_human || jsonb_build_object('mood_tags', v_next);
  v_data := coalesce(v_data, '{}'::jsonb) || jsonb_build_object('humanDna', v_human);

  UPDATE public.materials
  SET data = v_data, updated_at = now()
  WHERE id = p_material_id;

  RETURN jsonb_build_object('mood_tags', v_next);
END;
$$;

GRANT EXECUTE ON FUNCTION public.vote_material_mood_tag(uuid, text) TO authenticated;
