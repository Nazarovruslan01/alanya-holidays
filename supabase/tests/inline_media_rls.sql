\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'inline-media'
      AND public = true
      AND file_size_limit = 52428800
      AND allowed_mime_types = ARRAY['video/mp4', 'video/webm']
  ) THEN
    RAISE EXCEPTION 'inline-media bucket contract is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname LIKE 'inline_media_%'
  ) THEN
    RAISE EXCEPTION 'inline-media browser policy unexpectedly exists';
  END IF;
END;
$$;

INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES (
  'inline-media',
  '10000000-0000-4000-8000-000000000001/videos/20000000-0000-4000-8000-000000000001.mp4',
  NULL,
  '{"mimetype":"video/mp4","size":8}'::jsonb
);

SET LOCAL ROLE anon;
DO $$
DECLARE
  visible_count integer;
BEGIN
  SELECT count(*)
  INTO visible_count
  FROM storage.objects
  WHERE bucket_id = 'inline-media';

  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'anonymous inline-media listing unexpectedly returned rows';
  END IF;
END;
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
    VALUES (
      'inline-media',
      '10000000-0000-4000-8000-000000000002/videos/20000000-0000-4000-8000-000000000002.mp4',
      NULL,
      '{"mimetype":"video/mp4","size":8}'::jsonb
    );
    RAISE EXCEPTION 'authenticated inline-media insert unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'authenticated inline-media insert correctly denied';
  END;
END;
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DO $$
DECLARE
  affected_count integer;
BEGIN
  UPDATE storage.objects
  SET metadata = '{"mimetype":"video/mp4","size":9}'::jsonb
  WHERE bucket_id = 'inline-media';
  GET DIAGNOSTICS affected_count = ROW_COUNT;

  IF affected_count <> 0 THEN
    RAISE EXCEPTION 'authenticated inline-media update unexpectedly succeeded';
  END IF;
END;
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DO $$
DECLARE
  affected_count integer;
BEGIN
  DELETE FROM storage.objects WHERE bucket_id = 'inline-media';
  GET DIAGNOSTICS affected_count = ROW_COUNT;

  IF affected_count <> 0 THEN
    RAISE EXCEPTION 'authenticated inline-media delete unexpectedly succeeded';
  END IF;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE bucket_id = 'inline-media'
      AND metadata = '{"mimetype":"video/mp4","size":8}'::jsonb
  ) THEN
    RAISE EXCEPTION 'inline-media verification object was mutated or deleted';
  END IF;
END;
$$;

ROLLBACK;
