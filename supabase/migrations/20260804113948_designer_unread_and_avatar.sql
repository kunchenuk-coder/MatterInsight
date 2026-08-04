-- Designer unread tracking for sample_requests / inquiries
-- Navbar badge = count where designer_id = me AND is_read_by_designer = false

ALTER TABLE public.sample_requests
  ADD COLUMN IF NOT EXISTS is_read_by_designer boolean NOT NULL DEFAULT true;

ALTER TABLE public.inquiries
  ADD COLUMN IF NOT EXISTS is_read_by_designer boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.sample_requests.is_read_by_designer IS
  'false when supplier ships; designer marks true after viewing 申请记录';
COMMENT ON COLUMN public.inquiries.is_read_by_designer IS
  'false when supplier quotes; designer marks true after viewing 申请记录';

CREATE INDEX IF NOT EXISTS sample_requests_designer_unread_idx
  ON public.sample_requests (designer_id)
  WHERE is_read_by_designer = false;

CREATE INDEX IF NOT EXISTS inquiries_designer_unread_idx
  ON public.inquiries (designer_id)
  WHERE is_read_by_designer = false;

-- Existing shipped / quoted rows should show as unread until designer opens records
UPDATE public.sample_requests
SET is_read_by_designer = false
WHERE status = 'shipped'
  AND is_read_by_designer = true;

UPDATE public.inquiries
SET is_read_by_designer = false
WHERE status = 'quoted'
  AND quote_read_at IS NULL
  AND is_read_by_designer = true;

-- Ship RPC: mark unread for designer (keep existing 2-arg signature)
CREATE OR REPLACE FUNCTION public.ship_sample_request(
  p_request_id uuid,
  p_tracking_number text DEFAULT NULL
)
RETURNS public.sample_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_row public.sample_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id required';
  END IF;

  SELECT lower(role) INTO v_role FROM public.profiles WHERE id = v_uid;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  SELECT * INTO v_row
  FROM public.sample_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sample request not found';
  END IF;

  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'supplier' AND v_row.supplier_id = v_uid THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'not allowed to ship this sample request';
  END IF;

  IF v_row.status = 'shipped' OR v_row.status = 'completed' THEN
    -- Already shipped: still ensure designer unread if somehow marked read early
    IF v_row.is_read_by_designer THEN
      UPDATE public.sample_requests
      SET is_read_by_designer = false, updated_at = now()
      WHERE id = p_request_id
      RETURNING * INTO v_row;
    END IF;
    RETURN v_row;
  END IF;

  UPDATE public.sample_requests
  SET
    status = 'shipped',
    tracking_number = COALESCE(NULLIF(trim(p_tracking_number), ''), tracking_number),
    shipped_at = COALESCE(shipped_at, now()),
    is_read_by_designer = false,
    updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ship_sample_request(uuid, text) TO authenticated;

-- Count unread commerce items for designer navbar badge
CREATE OR REPLACE FUNCTION public.count_designer_unread_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_samples integer := 0;
  v_inquiries integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::integer INTO v_samples
  FROM public.sample_requests
  WHERE designer_id = v_uid
    AND is_read_by_designer = false;

  SELECT COUNT(*)::integer INTO v_inquiries
  FROM public.inquiries
  WHERE designer_id = v_uid
    AND is_read_by_designer = false;

  RETURN COALESCE(v_samples, 0) + COALESCE(v_inquiries, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_designer_unread_requests() TO authenticated;

-- Mark all unread sample/inquiry rows as read for current designer
CREATE OR REPLACE FUNCTION public.mark_designer_requests_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_a integer := 0;
  v_b integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.sample_requests
  SET
    is_read_by_designer = true,
    updated_at = now()
  WHERE designer_id = v_uid
    AND is_read_by_designer = false;
  GET DIAGNOSTICS v_a = ROW_COUNT;

  UPDATE public.inquiries
  SET
    is_read_by_designer = true,
    quote_read_at = COALESCE(quote_read_at, now()),
    updated_at = now()
  WHERE designer_id = v_uid
    AND is_read_by_designer = false;
  GET DIAGNOSTICS v_b = ROW_COUNT;

  RETURN COALESCE(v_a, 0) + COALESCE(v_b, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_designer_requests_read() TO authenticated;
