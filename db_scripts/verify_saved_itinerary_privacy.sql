\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_owner_id UUID := '14000000-0000-4000-8000-000000000001';
  v_other_id UUID := '14000000-0000-4000-8000-000000000002';
  v_private_id UUID := '24000000-0000-4000-8000-000000000001';
  v_public_id UUID := '24000000-0000-4000-8000-000000000002';
  v_count INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'saved_itineraries'
      AND column_name = 'is_public'
      AND is_nullable = 'NO'
      AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION 'saved_itineraries.is_public is not NOT NULL DEFAULT false';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'saved_itineraries'
      AND policyname = 'owner_all'
      AND cmd = 'ALL'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'saved_itineraries'
      AND policyname = 'public_read'
      AND cmd = 'SELECT'
      AND qual = '(is_public = true)'
  ) THEN
    RAISE EXCEPTION 'saved_itineraries privacy policies are missing or unexpected';
  END IF;

  INSERT INTO auth.users (id, email)
  VALUES
    (v_owner_id, 'itinerary-owner@example.test'),
    (v_other_id, 'itinerary-other@example.test');

  INSERT INTO public.saved_itineraries (
    id, user_id, title, params, itinerary
  ) VALUES (
    v_private_id,
    v_owner_id,
    'Private shared-param plan',
    '{"shared":true}'::JSONB,
    '[]'::JSONB
  );

  INSERT INTO public.saved_itineraries (
    id, user_id, title, params, itinerary, is_public
  ) VALUES (
    v_public_id,
    v_owner_id,
    'Public plan',
    '{}'::JSONB,
    '[]'::JSONB,
    true
  );

  IF (SELECT is_public FROM public.saved_itineraries WHERE id = v_private_id) THEN
    RAISE EXCEPTION 'new itinerary did not default to private';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_other_id, 'role', 'authenticated')::TEXT,
    true
  );
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_count
  FROM public.saved_itineraries
  WHERE id = v_private_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'non-owner read a private itinerary through params.shared';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.saved_itineraries
  WHERE id = v_public_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'authenticated user could not read a public itinerary';
  END IF;

  UPDATE public.saved_itineraries
  SET is_public = true
  WHERE id = v_private_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'non-owner published a private itinerary';
  END IF;
  RESET ROLE;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_owner_id, 'role', 'authenticated')::TEXT,
    true
  );
  SET LOCAL ROLE authenticated;

  UPDATE public.saved_itineraries
  SET is_public = true
  WHERE id = v_private_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'owner could not publish an itinerary';
  END IF;

  UPDATE public.saved_itineraries
  SET is_public = false
  WHERE id = v_private_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'owner could not unpublish an itinerary';
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', '{}', true);
  SET LOCAL ROLE anon;

  SELECT count(*) INTO v_count
  FROM public.saved_itineraries
  WHERE id = v_private_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'anonymous user read an unpublished itinerary';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.saved_itineraries
  WHERE id = v_public_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'anonymous user could not read a public itinerary';
  END IF;
  RESET ROLE;
END;
$$;

ROLLBACK;

SELECT 'Saved itinerary privacy verification passed' AS result;
