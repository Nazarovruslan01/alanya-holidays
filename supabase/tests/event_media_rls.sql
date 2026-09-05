\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS public.forum_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  role text
);

CREATE TABLE IF NOT EXISTS public.business_account_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_user_id uuid NOT NULL REFERENCES public.profiles(id),
  account_type text NOT NULL,
  business_name text NOT NULL,
  contact_email text NOT NULL,
  status text NOT NULL,
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_account_applications ENABLE ROW LEVEL SECURITY;
-- Supabase Storage enables this in production; the lightweight CI fixture must
-- opt in explicitly so client immutability/listing assertions exercise RLS.
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event media test: profile owner read" ON public.profiles;
CREATE POLICY "event media test: profile owner read"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "event media test: application owner read"
  ON public.business_account_applications;
CREATE POLICY "event media test: application owner read"
  ON public.business_account_applications
  FOR SELECT
  TO authenticated
  USING (applicant_user_id = (SELECT auth.uid()));

INSERT INTO auth.users (id) VALUES
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003')
ON CONFLICT (id) DO NOTHING;

-- Auth triggers create default profiles. Reinsert deterministic fixture roles so
-- the privilege-protection trigger is not exercised by fixture-only UPDATEs.
DELETE FROM public.profiles
WHERE id IN (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003'
);

INSERT INTO public.profiles (id, role) VALUES
  ('10000000-0000-4000-8000-000000000001', 'user'),
  ('10000000-0000-4000-8000-000000000002', 'user'),
  ('10000000-0000-4000-8000-000000000003', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.business_account_applications (
  id,
  applicant_user_id,
  account_type,
  business_name,
  contact_email,
  status,
  reviewed_by,
  reviewed_at
) VALUES (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  'seller',
  'Approved event manager',
  'manager@example.com',
  'approved',
  '10000000-0000-4000-8000-000000000003',
  now()
);

GRANT USAGE ON SCHEMA public, storage TO anon, authenticated;
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT SELECT ON public.business_account_applications TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;
GRANT SELECT ON storage.objects TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
-- Supabase bootstrap grants service_role access to application tables. The
-- lightweight migration fixture creates forum_events before those defaults.
GRANT SELECT ON public.forum_events TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'event_media_select_public'
  ) THEN
    RAISE EXCEPTION 'event-media must not expose storage object listing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'event-media' AND public = true
  ) THEN
    RAISE EXCEPTION 'event-media public URL retrieval must remain enabled';
  END IF;
END;
$$;

INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES
  (
    'event-media',
    '10000000-0000-4000-8000-000000000002/events/30000000-0000-4000-8000-000000000099.mp4',
    '10000000-0000-4000-8000-000000000002',
    '{"mimetype":"video/mp4","size":8}'::jsonb
  ),
  (
    'forum-media',
    'events/10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000099-full.webp',
    NULL,
    '{"mimetype":"image/webp","size":8}'::jsonb
  );

SET LOCAL ROLE anon;
SELECT count(*) AS anonymous_cover_listing_count
FROM storage.objects
WHERE bucket_id = 'forum-media' AND name LIKE 'events/%'
\gset
\if :anonymous_cover_listing_count
  \echo 'anonymous event-cover listing unexpectedly returned rows'
  \quit 1
\endif
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT count(*) AS manager_cover_listing_count
FROM storage.objects
WHERE bucket_id = 'forum-media' AND name LIKE 'events/%'
\gset
\if :manager_cover_listing_count
  \echo 'authenticated event-cover listing unexpectedly returned rows'
  \quit 1
\endif
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000003',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT count(*) AS admin_cover_listing_count
FROM storage.objects
WHERE bucket_id = 'forum-media' AND name LIKE 'events/%'
\gset
\if :admin_cover_listing_count
  \echo 'admin event-cover listing unexpectedly returned rows'
  \quit 1
\endif
RESET ROLE;

SAVEPOINT manager_cover_insert;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
\set ON_ERROR_STOP off
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES (
  'forum-media',
  'events/10000000-0000-4000-8000-000000000002/direct-manager.webp',
  NULL,
  '{"mimetype":"image/webp","size":8}'::jsonb
);
\if :ERROR
  \echo 'authenticated event-cover insert correctly denied'
\else
  \echo 'authenticated event-cover insert unexpectedly succeeded'
  \quit 1
\endif
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT manager_cover_insert;

SAVEPOINT admin_cover_delete;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000003',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
\set ON_ERROR_STOP off
DELETE FROM storage.objects
WHERE bucket_id = 'forum-media'
  AND name = 'events/10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000099-full.webp';
\set ON_ERROR_STOP on
\if :ERROR
  ROLLBACK TO SAVEPOINT admin_cover_delete;
\endif
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'forum-media'
      AND name = 'events/10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000099-full.webp'
  ) THEN
    RAISE EXCEPTION 'admin directly deleted a server-owned event cover';
  END IF;
END;
$$;
ROLLBACK TO SAVEPOINT admin_cover_delete;

SAVEPOINT immutable_client_object;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
UPDATE storage.objects
SET metadata = '{"mimetype":"text/plain","size":1}'::jsonb
WHERE bucket_id = 'event-media';
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'event-media' AND metadata->>'mimetype' = 'text/plain'
  ) THEN
    RAISE EXCEPTION 'authenticated client mutated an event-media object';
  END IF;
END;
$$;
ROLLBACK TO SAVEPOINT immutable_client_object;

SAVEPOINT immutable_client_cover;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
UPDATE storage.objects
SET metadata = '{"mimetype":"text/plain","size":1}'::jsonb
WHERE bucket_id = 'forum-media'
  AND name = 'events/10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000099-full.webp';
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'forum-media'
      AND name = 'events/10000000-0000-4000-8000-000000000002/30000000-0000-4000-8000-000000000099-full.webp'
      AND metadata->>'mimetype' = 'text/plain'
  ) THEN
    RAISE EXCEPTION 'authenticated client mutated a server-owned event cover';
  END IF;
END;
$$;
ROLLBACK TO SAVEPOINT immutable_client_cover;

SAVEPOINT regular_user_insert;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
\set ON_ERROR_STOP off
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES (
  'event-media',
  '10000000-0000-4000-8000-000000000001/events/30000000-0000-4000-8000-000000000001.mp4',
  '10000000-0000-4000-8000-000000000001',
  '{"mimetype":"video/mp4","size":8}'::jsonb
);
\if :ERROR
  \echo 'ordinary authenticated event-media insert correctly denied'
\else
  \echo 'ordinary authenticated event-media insert unexpectedly succeeded'
  \quit 1
\endif
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT regular_user_insert;

SAVEPOINT approved_manager_insert;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
\set ON_ERROR_STOP off
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES (
  'event-media',
  '10000000-0000-4000-8000-000000000002/events/30000000-0000-4000-8000-000000000002.webm',
  '10000000-0000-4000-8000-000000000002',
  '{"mimetype":"video/webm","size":8}'::jsonb
);
\if :ERROR
  \echo 'approved manager direct storage insert correctly denied'
\else
  \echo 'approved manager direct storage insert unexpectedly succeeded'
  \quit 1
\endif
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT approved_manager_insert;

SAVEPOINT invalid_manager_path_insert;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
\set ON_ERROR_STOP off
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES (
  'event-media',
  '10000000-0000-4000-8000-000000000002/not-events/free-hosting.webm',
  '10000000-0000-4000-8000-000000000002',
  '{"mimetype":"video/webm","size":8}'::jsonb
);
\if :ERROR
  \echo 'invalid manager object path correctly denied'
\else
  \echo 'invalid manager object path unexpectedly succeeded'
  \quit 1
\endif
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT invalid_manager_path_insert;

SAVEPOINT cross_owner_insert;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
\set ON_ERROR_STOP off
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES (
  'event-media',
  '10000000-0000-4000-8000-000000000001/events/30000000-0000-4000-8000-000000000003.mp4',
  '10000000-0000-4000-8000-000000000001',
  '{"mimetype":"video/mp4","size":8}'::jsonb
);
\if :ERROR
  \echo 'cross-owner event-media insert correctly denied'
\else
  \echo 'cross-owner event-media insert unexpectedly succeeded'
  \quit 1
\endif
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT cross_owner_insert;

SAVEPOINT admin_insert;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000003',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
\set ON_ERROR_STOP off
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES (
  'event-media',
  '10000000-0000-4000-8000-000000000003/events/30000000-0000-4000-8000-000000000004.mp4',
  '10000000-0000-4000-8000-000000000003',
  '{"mimetype":"video/mp4","size":8}'::jsonb
);
\if :ERROR
  \echo 'admin direct storage insert correctly denied'
\else
  \echo 'admin direct storage insert unexpectedly succeeded'
  \quit 1
\endif
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT admin_insert;

SET LOCAL ROLE anon;
SELECT count(*) AS anonymous_listing_count
FROM storage.objects
WHERE bucket_id = 'event-media'
\gset
\if :anonymous_listing_count
  \echo 'anonymous event-media object listing unexpectedly returned rows'
  \quit 1
\else
  \echo 'anonymous event-media object listing correctly returned no rows'
\endif

RESET ROLE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'event_media',
        'event_media_cleanup_outbox',
        'event_video_intent_reservations',
        'forum_event_create_requests'
      )
  ) THEN
    RAISE EXCEPTION 'event media tables must remain service-role only';
  END IF;
  IF has_table_privilege('authenticated', 'public.event_media', 'SELECT')
    OR has_table_privilege('anon', 'public.event_media', 'SELECT')
    OR has_table_privilege(
      'authenticated',
      'public.event_video_intent_reservations',
      'SELECT'
    )
    OR has_table_privilege(
      'anon',
      'public.event_video_intent_reservations',
      'SELECT'
    )
    OR has_table_privilege(
      'authenticated',
      'public.forum_event_create_requests',
      'SELECT'
    )
    OR has_table_privilege(
      'anon',
      'public.forum_event_create_requests',
      'SELECT'
    ) THEN
    RAISE EXCEPTION 'client role can inspect event_media';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.create_forum_event_with_media(uuid,jsonb,uuid,text,uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated role can call service-only event mutation RPC';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.reserve_event_video_intent(uuid,uuid,text,text,text,bigint,timestamptz)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated role can call video reservation RPC';
  END IF;
  IF position(
    'PG_ADVISORY_XACT_LOCK' IN upper(pg_get_functiondef(
      'public.create_forum_event_with_media(uuid,jsonb,uuid,text,uuid,uuid)'::regprocedure
    ))
  ) = 0 THEN
    RAISE EXCEPTION 'event create is missing same-key transaction serialization';
  END IF;
  IF position(
    'PG_ADVISORY_XACT_LOCK' IN upper(pg_get_functiondef(
      'public.reserve_event_video_intent(uuid,uuid,text,text,text,bigint,timestamptz)'::regprocedure
    ))
  ) = 0 THEN
    RAISE EXCEPTION 'video intent quota is missing owner serialization';
  END IF;
  IF position(
    'SKIP LOCKED' IN upper(pg_get_functiondef(
      'public.claim_event_media_cleanup(integer)'::regprocedure
    ))
  ) = 0 THEN
    RAISE EXCEPTION 'cleanup claim is missing SKIP LOCKED';
  END IF;
END;
$$;

SET LOCAL ROLE service_role;

SELECT public.reserve_event_video_intent(
  '41000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002/events/41000000-0000-4000-8000-000000000001.mp4',
  'https://project.supabase.co/storage/v1/object/public/event-media/10000000-0000-4000-8000-000000000002/events/41000000-0000-4000-8000-000000000001.mp4',
  'video/mp4',
  52428800,
  now() + interval '24 hours'
);
SELECT public.reserve_event_video_intent(
  '41000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002/events/41000000-0000-4000-8000-000000000002.mp4',
  'https://project.supabase.co/storage/v1/object/public/event-media/10000000-0000-4000-8000-000000000002/events/41000000-0000-4000-8000-000000000002.mp4',
  'video/mp4',
  52428800,
  now() + interval '24 hours'
);
SELECT public.reserve_event_video_intent(
  '41000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002/events/41000000-0000-4000-8000-000000000003.mp4',
  'https://project.supabase.co/storage/v1/object/public/event-media/10000000-0000-4000-8000-000000000002/events/41000000-0000-4000-8000-000000000003.mp4',
  'video/mp4',
  52428800,
  now() + interval '24 hours'
);

UPDATE public.event_media
SET state = 'ready'
WHERE id = '41000000-0000-4000-8000-000000000001';

DO $$
BEGIN
  BEGIN
    PERFORM public.reserve_event_video_intent(
      '41000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000002/events/41000000-0000-4000-8000-000000000004.mp4',
      'https://project.supabase.co/storage/v1/object/public/event-media/10000000-0000-4000-8000-000000000002/events/41000000-0000-4000-8000-000000000004.mp4',
      'video/mp4',
      1,
      now() + interval '24 hours'
    );
    RAISE EXCEPTION 'owner exceeded unfinished video intent quota';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'EVENT_VIDEO_INTENT_QUOTA_EXCEEDED' THEN RAISE; END IF;
  END;
END;
$$;

UPDATE public.event_media
SET state = 'cleanup_pending'
WHERE id = '41000000-0000-4000-8000-000000000001';

DO $$
BEGIN
  BEGIN
    PERFORM public.reserve_event_video_intent(
      '41000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000002/events/41000000-0000-4000-8000-000000000004.mp4',
      'https://project.supabase.co/storage/v1/object/public/event-media/10000000-0000-4000-8000-000000000002/events/41000000-0000-4000-8000-000000000004.mp4',
      'video/mp4',
      1,
      now() + interval '24 hours'
    );
    RAISE EXCEPTION 'owner bypassed live-object quota while cleanup was pending';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'EVENT_VIDEO_INTENT_QUOTA_EXCEEDED' THEN RAISE; END IF;
  END;
END;
$$;

-- Seven already-cleaned reservations bring the rolling-hour total to ten while
-- consuming neither unfinished count nor bytes. The audit tombstones must
-- still reject the eleventh signed-upload intent.
INSERT INTO public.event_video_intent_reservations (
  media_id, owner_id, size_bytes, created_at
)
SELECT
  gen_random_uuid(),
  '10000000-0000-4000-8000-000000000002',
  1,
  now()
FROM generate_series(1, 7);

DO $$
BEGIN
  BEGIN
    PERFORM public.reserve_event_video_intent(
      '41000000-0000-4000-8000-000000000005',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000002/events/41000000-0000-4000-8000-000000000005.mp4',
      'https://project.supabase.co/storage/v1/object/public/event-media/10000000-0000-4000-8000-000000000002/events/41000000-0000-4000-8000-000000000005.mp4',
      'video/mp4',
      1,
      now() + interval '24 hours'
    );
    RAISE EXCEPTION 'owner exceeded rolling video intent quota';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'EVENT_VIDEO_INTENT_QUOTA_EXCEEDED' THEN RAISE; END IF;
  END;
END;
$$;

DELETE FROM public.event_media
WHERE id::TEXT LIKE '41000000-0000-4000-8000-%';

DO $$
BEGIN
  IF (SELECT count(*) FROM public.event_video_intent_reservations
      WHERE owner_id = '10000000-0000-4000-8000-000000000002'
        AND created_at > now() - interval '1 hour') <> 10
  THEN
    RAISE EXCEPTION 'media cleanup erased rolling video intent history';
  END IF;
END;
$$;

DELETE FROM public.event_video_intent_reservations
WHERE owner_id = '10000000-0000-4000-8000-000000000002';

INSERT INTO public.event_media (
  id, owner_id, kind, bucket, object_path, thumbnail_path,
  public_url, thumbnail_url, mime_type, size_bytes, state, expires_at
) VALUES
  (
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'image', 'forum-media',
    'events/10000000-0000-4000-8000-000000000003/image-old-full.webp',
    'events/10000000-0000-4000-8000-000000000003/image-old-thumb.webp',
    'https://project.supabase.co/storage/v1/object/public/forum-media/admin/image-old-full.webp',
    'https://project.supabase.co/storage/v1/object/public/forum-media/admin/image-old-thumb.webp',
    'image/webp', 100, 'ready', now() + interval '1 day'
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
    'video', 'event-media',
    '10000000-0000-4000-8000-000000000003/events/video-old.mp4',
    NULL,
    'https://project.supabase.co/storage/v1/object/public/event-media/admin/video-old.mp4',
    NULL, 'video/mp4', 100, 'ready', now() + interval '1 day'
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002',
    'video', 'event-media',
    '10000000-0000-4000-8000-000000000002/events/cross-owner.webm',
    NULL,
    'https://project.supabase.co/storage/v1/object/public/event-media/manager/cross-owner.webm',
    NULL, 'video/webm', 100, 'ready', now() + interval '1 day'
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000003',
    'video', 'event-media',
    '10000000-0000-4000-8000-000000000003/events/video-new.webm',
    NULL,
    'https://project.supabase.co/storage/v1/object/public/event-media/admin/video-new.webm',
    NULL, 'video/webm', 100, 'ready', now() + interval '1 day'
  ),
  (
    '40000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000003',
    'image', 'forum-media',
    'events/10000000-0000-4000-8000-000000000003/image-partial-full.webp',
    'events/10000000-0000-4000-8000-000000000003/image-partial-thumb.webp',
    'https://project.supabase.co/storage/v1/object/public/forum-media/admin/image-partial-full.webp',
    'https://project.supabase.co/storage/v1/object/public/forum-media/admin/image-partial-thumb.webp',
    'image/webp', 100, 'ready', now() + interval '1 day'
  );

-- A synchronous partial-upload cleanup may know only one successful path. The
-- owner cleanup seam must deepen that record to every persisted object path so
-- an ambiguous sibling upload cannot be orphaned.
SELECT public.queue_event_media_cleanup_paths(
  '40000000-0000-4000-8000-000000000006',
  'forum-media',
  ARRAY['events/10000000-0000-4000-8000-000000000003/image-partial-full.webp'],
  'thumbnail upload failed'
);
SELECT public.queue_owned_event_media_cleanup(
  '40000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000003'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_media_cleanup_outbox
    WHERE media_id = '40000000-0000-4000-8000-000000000006'
      AND object_paths @> ARRAY[
        'events/10000000-0000-4000-8000-000000000003/image-partial-full.webp',
        'events/10000000-0000-4000-8000-000000000003/image-partial-thumb.webp'
      ]
  ) THEN
    RAISE EXCEPTION 'partial image cleanup did not retain every persisted path';
  END IF;
END;
$$;

INSERT INTO public.event_media (
  id, owner_id, kind, bucket, object_path, public_url,
  mime_type, size_bytes, state, expires_at
) VALUES (
  '40000000-0000-4000-8000-000000000007',
  '10000000-0000-4000-8000-000000000002',
  'video', 'event-media',
  '10000000-0000-4000-8000-000000000002/events/leased.mp4',
  'https://project.supabase.co/storage/v1/object/public/event-media/manager/leased.mp4',
  'video/mp4', 100, 'pending', now() + interval '24 hours'
);

SELECT public.queue_owned_event_media_cleanup(
  '40000000-0000-4000-8000-000000000007',
  '10000000-0000-4000-8000-000000000002'
);
SELECT public.queue_owned_event_media_cleanup(
  '40000000-0000-4000-8000-000000000007',
  '10000000-0000-4000-8000-000000000002'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.event_media AS media
    JOIN public.event_media_cleanup_outbox AS outbox
      ON outbox.media_id = media.id
    WHERE media.id = '40000000-0000-4000-8000-000000000007'
      AND media.state = 'cleanup_pending'
      AND outbox.status = 'pending'
      AND outbox.next_attempt_at >= media.expires_at
      AND outbox.object_paths = ARRAY[media.object_path]
  ) THEN
    RAISE EXCEPTION 'pending-video cleanup did not preserve its upload lease';
  END IF;
END;
$$;

SAVEPOINT before_leased_cleanup_claim;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.claim_event_media_cleanup(50)
    WHERE media_id = '40000000-0000-4000-8000-000000000007'
  ) THEN
    RAISE EXCEPTION 'pending-video cleanup was claimed before lease expiry';
  END IF;
END;
$$;
ROLLBACK TO SAVEPOINT before_leased_cleanup_claim;

-- Advance the durable lease seam without waiting for wall-clock expiry. A
-- post-expiry claim must remove the tombstone only after object deletion is
-- reported successful.
UPDATE public.event_media_cleanup_outbox
SET next_attempt_at = now() - interval '100 years'
WHERE media_id = '40000000-0000-4000-8000-000000000007';

SELECT id AS leased_cleanup_outbox_id
FROM public.claim_event_media_cleanup(1)
WHERE media_id = '40000000-0000-4000-8000-000000000007'
\gset
\if :{?leased_cleanup_outbox_id}
  SELECT public.complete_event_media_cleanup(
    :'leased_cleanup_outbox_id',
    true,
    NULL
  );
\else
  \echo 'post-expiry pending-video cleanup was not claimable'
  \quit 1
\endif

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.event_media
    WHERE id = '40000000-0000-4000-8000-000000000007'
  ) THEN
    RAISE EXCEPTION 'successful post-expiry cleanup retained its tombstone';
  END IF;
END;
$$;

-- Finalizing does not revoke the signed upload token. Abandoning a ready video
-- must therefore retain the same post-token cleanup lease as a pending video.
INSERT INTO public.event_media (
  id, owner_id, kind, bucket, object_path, public_url,
  mime_type, size_bytes, state, expires_at
) VALUES (
  '40000000-0000-4000-8000-000000000009',
  '10000000-0000-4000-8000-000000000002',
  'video', 'event-media',
  '10000000-0000-4000-8000-000000000002/events/ready-lease.mp4',
  'https://project.supabase.co/storage/v1/object/public/event-media/manager/ready-lease.mp4',
  'video/mp4', 100, 'ready', now() + interval '24 hours'
);
SELECT public.queue_owned_event_media_cleanup(
  '40000000-0000-4000-8000-000000000009',
  '10000000-0000-4000-8000-000000000002'
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.event_media AS media
    JOIN public.event_media_cleanup_outbox AS outbox
      ON outbox.media_id = media.id
    WHERE media.id = '40000000-0000-4000-8000-000000000009'
      AND media.state = 'cleanup_pending'
      AND outbox.next_attempt_at >= media.expires_at
  ) THEN
    RAISE EXCEPTION 'ready-video cleanup did not preserve its upload lease';
  END IF;
END;
$$;
SAVEPOINT before_ready_video_cleanup_claim;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.claim_event_media_cleanup(50)
    WHERE media_id = '40000000-0000-4000-8000-000000000009'
  ) THEN
    RAISE EXCEPTION 'ready-video cleanup was claimed before lease expiry';
  END IF;
END;
$$;
ROLLBACK TO SAVEPOINT before_ready_video_cleanup_claim;
DELETE FROM public.event_media_cleanup_outbox
WHERE media_id = '40000000-0000-4000-8000-000000000009';
DELETE FROM public.event_media
WHERE id = '40000000-0000-4000-8000-000000000009';

SELECT (
  public.create_forum_event_with_media(
  '10000000-0000-4000-8000-000000000003',
  jsonb_build_object(
    'title', 'Atomic Media Event',
    'slug', 'atomic-media-event-test',
    'event_date', '2026-09-10T18:00:00Z',
    'host_id', '10000000-0000-4000-8000-000000000002',
    'is_published', true
  ),
  '50000000-0000-4000-8000-000000000001',
  repeat('a', 64),
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002'
  ) ->> 'id'
) AS atomic_event_id
\gset

DO $$
BEGIN
  IF public.queue_owned_event_media_cleanup(
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003'
  ) OR EXISTS (
    SELECT 1 FROM public.event_media_cleanup_outbox
    WHERE media_id = '40000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'attached media entered owner-requested cleanup';
  END IF;
END;
$$;

-- A stale or manually requeued outbox row must not let a worker remove an
-- object that is currently attached. Claiming is the last database boundary
-- before Storage deletion.
INSERT INTO public.event_media_cleanup_outbox (
  media_id, bucket, object_paths, status, next_attempt_at
) VALUES (
  '40000000-0000-4000-8000-000000000002',
  'event-media',
  ARRAY['10000000-0000-4000-8000-000000000003/events/video-old.mp4'],
  'pending',
  now() - interval '100 years'
);
SAVEPOINT before_attached_media_claim;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.claim_event_media_cleanup(1)
    WHERE media_id = '40000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'cleanup worker claimed attached media';
  END IF;
END;
$$;
ROLLBACK TO SAVEPOINT before_attached_media_claim;
DELETE FROM public.event_media_cleanup_outbox
WHERE media_id = '40000000-0000-4000-8000-000000000002';

-- A committed exact replay must return before ready-state validation, because
-- both media rows are attached by the first call.
SELECT (
  public.create_forum_event_with_media(
    '10000000-0000-4000-8000-000000000003',
    jsonb_build_object(
      'title', 'Atomic Media Event',
      'slug', 'a-different-derived-slug-is-ignored-on-replay',
      'event_date', '2026-09-10T18:00:00Z',
      'host_id', '10000000-0000-4000-8000-000000000002',
      'is_published', true
    ),
    '50000000-0000-4000-8000-000000000001',
    repeat('a', 64),
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002'
  ) ->> 'id'
) = :'atomic_event_id' AS exact_replay_returned_original
\gset
\if :exact_replay_returned_original
  \echo 'exact event-create replay returned the original event'
\else
  \echo 'exact event-create replay did not return the original event'
  \quit 1
\endif

DO $$
BEGIN
  BEGIN
    PERFORM public.create_forum_event_with_media(
      '10000000-0000-4000-8000-000000000003',
      jsonb_build_object(
        'title', 'Changed request',
        'slug', 'changed-request',
        'event_date', '2026-09-10T18:00:00Z'
      ),
      '50000000-0000-4000-8000-000000000001',
      repeat('b', 64),
      NULL,
      NULL
    );
    RAISE EXCEPTION 'changed payload reused an idempotency key';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM public.forum_event_create_requests
      WHERE actor_id = '10000000-0000-4000-8000-000000000003'
        AND idempotency_key = '50000000-0000-4000-8000-000000000001') <> 1
    OR (SELECT count(*) FROM public.forum_events
        WHERE slug IN ('atomic-media-event-test', 'changed-request')) <> 1
  THEN
    RAISE EXCEPTION 'idempotency mismatch mutated event state';
  END IF;
END;
$$;

SELECT (
  public.create_forum_event_with_media(
    '10000000-0000-4000-8000-000000000002',
    jsonb_build_object(
      'title', 'Actor-isolated Event',
      'slug', 'actor-isolated-event-test',
      'event_date', '2026-09-12T18:00:00Z'
    ),
    '50000000-0000-4000-8000-000000000001',
    repeat('d', 64),
    NULL,
    NULL
  ) ->> 'id'
) AS actor_isolated_event_id
\gset

DO $$
BEGIN
  IF (SELECT count(*) FROM public.forum_event_create_requests
      WHERE idempotency_key = '50000000-0000-4000-8000-000000000001') <> 2
    OR NOT EXISTS (
      SELECT 1 FROM public.forum_events
      WHERE slug = 'actor-isolated-event-test'
        AND created_by = '10000000-0000-4000-8000-000000000002'
    )
  THEN
    RAISE EXCEPTION 'idempotency keys were not isolated by actor';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    PERFORM public.create_forum_event_with_media(
      '10000000-0000-4000-8000-000000000003',
      jsonb_build_object(
        'title', 'Reused Media',
        'slug', 'reused-media-test',
        'event_date', '2026-09-11T18:00:00Z'
      ),
      '50000000-0000-4000-8000-000000000002',
      repeat('c', 64),
      NULL,
      '40000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'attached media was reused';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM public.update_forum_event_with_media(
      '10000000-0000-4000-8000-000000000003',
      (SELECT id FROM public.forum_events WHERE slug = 'atomic-media-event-test'),
      '{}'::jsonb,
      false, NULL, true,
      '40000000-0000-4000-8000-000000000003'
    );
    RAISE EXCEPTION 'cross-owner media was attached';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.event_media_cleanup_outbox
    WHERE media_id = '40000000-0000-4000-8000-000000000002'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.event_media
    WHERE id = '40000000-0000-4000-8000-000000000002'
      AND state = 'attached'
  ) THEN
    RAISE EXCEPTION 'failed replacement scheduled or changed old media';
  END IF;
END;
$$;

SELECT public.update_forum_event_with_media(
  '10000000-0000-4000-8000-000000000003',
  (SELECT id FROM public.forum_events WHERE slug = 'atomic-media-event-test'),
  '{}'::jsonb,
  false, NULL, true,
  '40000000-0000-4000-8000-000000000004'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_media m
    JOIN public.event_media_cleanup_outbox o ON o.media_id = m.id
    WHERE m.id = '40000000-0000-4000-8000-000000000002'
      AND m.state = 'cleanup_pending'
      AND o.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'replacement did not durably enqueue old media';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.event_media m
    JOIN public.forum_events e ON e.id = m.event_id
    WHERE m.id = '40000000-0000-4000-8000-000000000004'
      AND m.state = 'attached'
      AND e.video_url = m.public_url
      AND e.host_id = '10000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'admin-owned replacement for hosted event was not attached';
  END IF;
END;
$$;

SELECT public.delete_forum_event_with_media(
  '10000000-0000-4000-8000-000000000003',
  (SELECT id FROM public.forum_events WHERE slug = 'atomic-media-event-test')
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.forum_events WHERE slug = 'atomic-media-event-test') THEN
    RAISE EXCEPTION 'event delete failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.event_media_cleanup_outbox
    WHERE media_id IN (
      '40000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000004'
    ) AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'delete did not durably enqueue attached media';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.forum_event_create_requests
    WHERE actor_id = '10000000-0000-4000-8000-000000000003'
      AND idempotency_key = '50000000-0000-4000-8000-000000000001'
      AND event_id IS NULL
      AND response_payload->>'slug' = 'atomic-media-event-test'
  ) THEN
    RAISE EXCEPTION 'event deletion discarded its idempotency tombstone';
  END IF;
END;
$$;

SELECT (
  public.create_forum_event_with_media(
    '10000000-0000-4000-8000-000000000003',
    jsonb_build_object(
      'title', 'Atomic Media Event',
      'slug', 'deleted-event-must-not-be-recreated',
      'event_date', '2026-09-10T18:00:00Z',
      'host_id', '10000000-0000-4000-8000-000000000002',
      'is_published', true
    ),
    '50000000-0000-4000-8000-000000000001',
    repeat('a', 64),
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002'
  ) ->> 'id'
) = :'atomic_event_id' AS deleted_event_replay_returned_tombstone
\gset
\if :deleted_event_replay_returned_tombstone
  \echo 'deleted event replay returned the stored response without recreation'
\else
  \echo 'deleted event replay did not return the stored response'
  \quit 1
\endif

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.forum_events
    WHERE slug = 'deleted-event-must-not-be-recreated'
  ) OR (SELECT count(*) FROM public.forum_event_create_requests
        WHERE actor_id = '10000000-0000-4000-8000-000000000003'
          AND idempotency_key = '50000000-0000-4000-8000-000000000001') <> 1
  THEN
    RAISE EXCEPTION 'deleted event replay recreated or duplicated state';
  END IF;
END;
$$;

INSERT INTO public.event_media (
  id, owner_id, kind, bucket, object_path, public_url,
  mime_type, size_bytes, state, expires_at
) VALUES (
  '40000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000002',
  'video', 'event-media',
  '10000000-0000-4000-8000-000000000002/events/expired.mp4',
  'https://project.supabase.co/storage/v1/object/public/event-media/manager/expired.mp4',
  'video/mp4', 100, 'ready', now() - interval '1 minute'
);
SELECT public.enqueue_expired_event_media(10);
SELECT public.enqueue_expired_event_media(10);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.event_media_cleanup_outbox
      WHERE media_id = '40000000-0000-4000-8000-000000000005') <> 1 THEN
    RAISE EXCEPTION 'expired media cleanup was not idempotent';
  END IF;
END;
$$;

INSERT INTO public.event_media (
  id, owner_id, kind, bucket, object_path, public_url,
  mime_type, size_bytes, state, expires_at
) VALUES (
  '40000000-0000-4000-8000-000000000008',
  '10000000-0000-4000-8000-000000000002',
  'video', 'event-media',
  '10000000-0000-4000-8000-000000000002/events/retry.mp4',
  'https://project.supabase.co/storage/v1/object/public/event-media/manager/retry.mp4',
  'video/mp4', 100, 'cleanup_pending', NULL
);
INSERT INTO public.event_media_cleanup_outbox (
  media_id, bucket, object_paths, status, attempts, next_attempt_at
) VALUES (
  '40000000-0000-4000-8000-000000000008',
  'event-media',
  ARRAY['10000000-0000-4000-8000-000000000002/events/retry.mp4'],
  'pending',
  4,
  now() - interval '100 years'
);

SELECT id AS fifth_failure_outbox_id
FROM public.claim_event_media_cleanup(1)
WHERE media_id = '40000000-0000-4000-8000-000000000008'
\gset
\if :{?fifth_failure_outbox_id}
\else
  \echo 'fifth cleanup attempt was not claimable'
  \quit 1
\endif

SELECT public.complete_event_media_cleanup(
  :'fifth_failure_outbox_id',
  false,
  'fifth transient storage failure'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_media_cleanup_outbox
    WHERE media_id = '40000000-0000-4000-8000-000000000008'
      AND status = 'pending'
      AND attempts = 5
      AND next_attempt_at > now()
      AND last_error = 'fifth transient storage failure'
  ) THEN
    RAISE EXCEPTION 'fifth cleanup failure became terminal';
  END IF;
END;
$$;

UPDATE public.event_media_cleanup_outbox
SET next_attempt_at = now() - interval '100 years'
WHERE media_id = '40000000-0000-4000-8000-000000000008';

SELECT id AS recovered_cleanup_outbox_id
FROM public.claim_event_media_cleanup(1)
WHERE media_id = '40000000-0000-4000-8000-000000000008'
\gset
\if :{?recovered_cleanup_outbox_id}
\else
  \echo 'cleanup was not claimable after its fifth failure'
  \quit 1
\endif

CREATE TEMP TABLE recovered_cleanup_assertion AS
SELECT :'recovered_cleanup_outbox_id'::BIGINT AS outbox_id;

SELECT public.complete_event_media_cleanup(
  :'recovered_cleanup_outbox_id',
  true,
  NULL
);
SELECT public.complete_event_media_cleanup(
  :'recovered_cleanup_outbox_id',
  false,
  'late failure from an older worker'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_media_cleanup_outbox
    WHERE id = (SELECT outbox_id FROM recovered_cleanup_assertion)
      AND status = 'completed'
      AND attempts = 6
  ) OR EXISTS (
      SELECT 1 FROM public.event_media
      WHERE id = '40000000-0000-4000-8000-000000000008'
    )
  THEN
    RAISE EXCEPTION 'cleanup did not recover after its fifth failure';
  END IF;
END;
$$;

CREATE TEMP TABLE first_event_media_claim AS
  SELECT * FROM public.claim_event_media_cleanup(50);
CREATE TEMP TABLE second_event_media_claim AS
  SELECT * FROM public.claim_event_media_cleanup(50);

DO $$
DECLARE v_outbox_id BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM first_event_media_claim a
    JOIN second_event_media_claim b USING (id)
  ) THEN
    RAISE EXCEPTION 'cleanup outbox row was claimed twice';
  END IF;
  SELECT id INTO v_outbox_id FROM first_event_media_claim ORDER BY id LIMIT 1;
  PERFORM public.complete_event_media_cleanup(v_outbox_id, false, 'temporary storage failure');
  IF NOT EXISTS (
    SELECT 1 FROM public.event_media_cleanup_outbox
    WHERE id = v_outbox_id
      AND status = 'pending'
      AND attempts = 1
      AND next_attempt_at > now()
      AND last_error = 'temporary storage failure'
  ) THEN
    RAISE EXCEPTION 'failed cleanup was not preserved for retry';
  END IF;
END;
$$;

ROLLBACK;

-- Run the same idempotency key from two independent database sessions. This
-- phase is intentionally committed because dblink sessions cannot observe the
-- fixture transaction above; the disposable test database is cleaned below.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
\if :{?event_media_test_password}
\else
  \getenv event_media_test_password PGPASSWORD
\endif
SELECT format(
  'host=%L port=%s dbname=%L user=%L password=%L',
  host(inet_server_addr()),
  inet_server_port(),
  current_database(),
  current_user,
  :'event_media_test_password'
) AS event_media_test_dblink_connection
\gset

INSERT INTO auth.users (id) VALUES
  ('10000000-0000-4000-8000-000000000010')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, role) VALUES
  ('10000000-0000-4000-8000-000000000010', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

SELECT extensions.dblink_connect(
  'event_create_first',
  :'event_media_test_dblink_connection'
);
SELECT extensions.dblink_connect(
  'event_create_second',
  :'event_media_test_dblink_connection'
);
SELECT extensions.dblink_send_query(
  'event_create_first',
  $query$
    SELECT public.create_forum_event_with_media(
      '10000000-0000-4000-8000-000000000010',
      jsonb_build_object(
        'title', 'Concurrent Event',
        'slug', 'concurrent-event-idempotency-test',
        'event_date', '2026-09-15T18:00:00Z'
      ),
      '50000000-0000-4000-8000-000000000010',
      repeat('e', 64),
      NULL,
      NULL
    )
  $query$
);
SELECT extensions.dblink_send_query(
  'event_create_second',
  $query$
    SELECT public.create_forum_event_with_media(
      '10000000-0000-4000-8000-000000000010',
      jsonb_build_object(
        'title', 'Concurrent Event',
        'slug', 'concurrent-event-idempotency-test',
        'event_date', '2026-09-15T18:00:00Z'
      ),
      '50000000-0000-4000-8000-000000000010',
      repeat('e', 64),
      NULL,
      NULL
    )
  $query$
);

CREATE TEMP TABLE concurrent_event_create_results (response_payload JSONB);
INSERT INTO concurrent_event_create_results
SELECT response_payload
FROM extensions.dblink_get_result('event_create_first')
  AS result(response_payload JSONB);
INSERT INTO concurrent_event_create_results
SELECT response_payload
FROM extensions.dblink_get_result('event_create_second')
  AS result(response_payload JSONB);
SELECT extensions.dblink_disconnect('event_create_first');
SELECT extensions.dblink_disconnect('event_create_second');

DO $$
BEGIN
  IF (SELECT count(*) FROM concurrent_event_create_results) <> 2
    OR (SELECT count(DISTINCT response_payload->>'id')
        FROM concurrent_event_create_results) <> 1
    OR (SELECT count(*) FROM public.forum_events
        WHERE slug = 'concurrent-event-idempotency-test') <> 1
    OR (SELECT count(*) FROM public.forum_event_create_requests
        WHERE actor_id = '10000000-0000-4000-8000-000000000010'
          AND idempotency_key = '50000000-0000-4000-8000-000000000010') <> 1
  THEN
    RAISE EXCEPTION 'concurrent same-key calls did not create exactly once';
  END IF;
END;
$$;

DELETE FROM public.forum_events
WHERE created_by = '10000000-0000-4000-8000-000000000010';
DELETE FROM public.forum_event_create_requests
WHERE actor_id = '10000000-0000-4000-8000-000000000010';
DELETE FROM public.profiles
WHERE id = '10000000-0000-4000-8000-000000000010';
DELETE FROM auth.users
WHERE id = '10000000-0000-4000-8000-000000000010';

INSERT INTO auth.users (id) VALUES
  ('10000000-0000-4000-8000-000000000020')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, role) VALUES
  ('10000000-0000-4000-8000-000000000020', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

SELECT public.reserve_event_video_intent(
  '41000000-0000-4000-8000-000000000020',
  '10000000-0000-4000-8000-000000000020',
  '10000000-0000-4000-8000-000000000020/events/41000000-0000-4000-8000-000000000020.mp4',
  'https://project.supabase.co/storage/v1/object/public/event-media/10000000-0000-4000-8000-000000000020/events/41000000-0000-4000-8000-000000000020.mp4',
  'video/mp4',
  52428800,
  now() + interval '24 hours'
);
SELECT public.reserve_event_video_intent(
  '41000000-0000-4000-8000-000000000021',
  '10000000-0000-4000-8000-000000000020',
  '10000000-0000-4000-8000-000000000020/events/41000000-0000-4000-8000-000000000021.mp4',
  'https://project.supabase.co/storage/v1/object/public/event-media/10000000-0000-4000-8000-000000000020/events/41000000-0000-4000-8000-000000000021.mp4',
  'video/mp4',
  52428800,
  now() + interval '24 hours'
);

SELECT extensions.dblink_connect(
  'event_video_quota_first',
  :'event_media_test_dblink_connection'
);
SELECT extensions.dblink_connect(
  'event_video_quota_second',
  :'event_media_test_dblink_connection'
);
SELECT extensions.dblink_send_query(
  'event_video_quota_first',
  $query$
    SELECT public.reserve_event_video_intent(
      '41000000-0000-4000-8000-000000000022',
      '10000000-0000-4000-8000-000000000020',
      '10000000-0000-4000-8000-000000000020/events/41000000-0000-4000-8000-000000000022.mp4',
      'https://project.supabase.co/storage/v1/object/public/event-media/10000000-0000-4000-8000-000000000020/events/41000000-0000-4000-8000-000000000022.mp4',
      'video/mp4',
      1,
      now() + interval '24 hours'
    )
  $query$
);
SELECT extensions.dblink_send_query(
  'event_video_quota_second',
  $query$
    SELECT public.reserve_event_video_intent(
      '41000000-0000-4000-8000-000000000023',
      '10000000-0000-4000-8000-000000000020',
      '10000000-0000-4000-8000-000000000020/events/41000000-0000-4000-8000-000000000023.mp4',
      'https://project.supabase.co/storage/v1/object/public/event-media/10000000-0000-4000-8000-000000000020/events/41000000-0000-4000-8000-000000000023.mp4',
      'video/mp4',
      1,
      now() + interval '24 hours'
    )
  $query$
);

CREATE TEMP TABLE concurrent_video_intent_results (response_payload JSONB);
INSERT INTO concurrent_video_intent_results
SELECT response_payload
FROM extensions.dblink_get_result('event_video_quota_first', false)
  AS result(response_payload JSONB);
INSERT INTO concurrent_video_intent_results
SELECT response_payload
FROM extensions.dblink_get_result('event_video_quota_second', false)
  AS result(response_payload JSONB);

CREATE TEMP TABLE concurrent_video_intent_errors (message TEXT);
INSERT INTO concurrent_video_intent_errors VALUES
  (extensions.dblink_error_message('event_video_quota_first')),
  (extensions.dblink_error_message('event_video_quota_second'));
SELECT extensions.dblink_disconnect('event_video_quota_first');
SELECT extensions.dblink_disconnect('event_video_quota_second');

DO $$
BEGIN
  IF (SELECT count(*) FROM concurrent_video_intent_results) <> 1
    OR (SELECT count(*) FROM public.event_media
        WHERE owner_id = '10000000-0000-4000-8000-000000000020'
          AND kind = 'video'
          AND state IN ('pending', 'ready')) <> 3
    OR (SELECT count(*) FROM public.event_video_intent_reservations
        WHERE owner_id = '10000000-0000-4000-8000-000000000020') <> 3
    OR (SELECT count(*) FROM concurrent_video_intent_errors
        WHERE message LIKE '%EVENT_VIDEO_INTENT_QUOTA_EXCEEDED%') <> 1
  THEN
    RAISE EXCEPTION 'concurrent calls bypassed owner video intent quota';
  END IF;
END;
$$;

DELETE FROM public.event_media
WHERE owner_id = '10000000-0000-4000-8000-000000000020';
DELETE FROM public.profiles
WHERE id = '10000000-0000-4000-8000-000000000020';
DELETE FROM auth.users
WHERE id = '10000000-0000-4000-8000-000000000020';
