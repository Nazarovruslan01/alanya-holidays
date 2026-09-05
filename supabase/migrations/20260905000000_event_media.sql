-- Event media: immutable signed uploads, transactional attachment, and durable cleanup.
-- Additive only: legacy forum_events URL values remain readable.

ALTER TABLE public.forum_events ADD COLUMN IF NOT EXISTS video_url TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('event-media', 'event-media', true, 52428800, ARRAY['video/mp4', 'video/webm'])
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public buckets remain fetchable by known URL. No client role may list or mutate
-- storage.objects; uploads use server-issued signed, non-upsert URLs.
DROP POLICY IF EXISTS "event_media_select_public" ON storage.objects;
DROP POLICY IF EXISTS "event_media_insert_owner" ON storage.objects;
DROP POLICY IF EXISTS "event_media_update_owner" ON storage.objects;
DROP POLICY IF EXISTS "event_media_delete_owner" ON storage.objects;

-- Processed event covers share the public forum-media bucket for URL
-- compatibility, but the events/ namespace is server-owned. Public buckets are
-- still retrievable by known URL without granting storage.objects listing.
DROP POLICY IF EXISTS "forum_media_select_public" ON storage.objects;
DROP POLICY IF EXISTS "forum_media_insert_auth" ON storage.objects;
DROP POLICY IF EXISTS "forum_media_update_owner" ON storage.objects;
DROP POLICY IF EXISTS "forum_media_delete_owner_admin" ON storage.objects;

CREATE POLICY "forum_media_select_public" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'forum-media'
    AND COALESCE((storage.foldername(name))[1], '') <> 'events'
  );

CREATE POLICY "forum_media_insert_auth" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'forum-media'
    AND COALESCE((storage.foldername(name))[1], '') <> 'events'
    AND (SELECT auth.role()) = 'authenticated'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );

CREATE POLICY "forum_media_update_owner" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'forum-media'
    AND COALESCE((storage.foldername(name))[1], '') <> 'events'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  ) WITH CHECK (
    bucket_id = 'forum-media'
    AND COALESCE((storage.foldername(name))[1], '') <> 'events'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
  );

CREATE POLICY "forum_media_delete_owner_admin" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'forum-media'
    AND COALESCE((storage.foldername(name))[1], '') <> 'events'
    AND (
      (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = (SELECT auth.uid()) AND role = 'admin'
      )
    )
  );

CREATE TABLE IF NOT EXISTS public.event_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.profiles(id),
  event_id UUID REFERENCES public.forum_events(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  bucket TEXT NOT NULL CHECK (bucket IN ('forum-media', 'event-media')),
  object_path TEXT NOT NULL UNIQUE,
  thumbnail_path TEXT,
  public_url TEXT NOT NULL,
  thumbnail_url TEXT,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'ready', 'attached', 'cleanup_pending', 'failed')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'image' AND bucket = 'forum-media' AND mime_type = 'image/webp' AND thumbnail_path IS NOT NULL AND thumbnail_url IS NOT NULL)
    OR
    (kind = 'video' AND bucket = 'event-media' AND mime_type IN ('video/mp4', 'video/webm') AND thumbnail_path IS NULL AND thumbnail_url IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_event_media_owner ON public.event_media (owner_id);
CREATE INDEX IF NOT EXISTS idx_event_media_event ON public.event_media (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_media_expiry ON public.event_media (expires_at, id) WHERE state IN ('pending', 'ready');
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_media_attached_kind ON public.event_media (event_id, kind) WHERE state = 'attached';

ALTER TABLE public.event_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_media FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.event_media TO service_role;

-- A quota tombstone is intentionally independent of the media row so cleanup
-- cannot erase rolling-hour intent history. It contains no client-readable
-- data and is pruned lazily, under the same owner lock, after the quota window
-- closes.
CREATE TABLE IF NOT EXISTS public.event_video_intent_reservations (
  media_id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_video_intent_reservations_owner_created
  ON public.event_video_intent_reservations (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_video_intent_reservations_created
  ON public.event_video_intent_reservations (created_at);

ALTER TABLE public.event_video_intent_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_video_intent_reservations
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.event_video_intent_reservations TO service_role;

CREATE TABLE IF NOT EXISTS public.forum_event_create_requests (
  actor_id UUID NOT NULL REFERENCES public.profiles(id),
  idempotency_key UUID NOT NULL,
  request_fingerprint TEXT NOT NULL
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  event_id UUID UNIQUE
    REFERENCES public.forum_events(id) ON DELETE SET NULL,
  response_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, idempotency_key)
);

ALTER TABLE public.forum_event_create_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.forum_event_create_requests
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.forum_event_create_requests TO service_role;

CREATE TABLE IF NOT EXISTS public.event_media_cleanup_outbox (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  media_id UUID UNIQUE REFERENCES public.event_media(id) ON DELETE SET NULL,
  bucket TEXT NOT NULL CHECK (bucket IN ('forum-media', 'event-media')),
  object_paths TEXT[] NOT NULL CHECK (cardinality(object_paths) > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_event_media_cleanup_claim
  ON public.event_media_cleanup_outbox (next_attempt_at, id)
  WHERE status IN ('pending', 'processing', 'failed');

ALTER TABLE public.event_media_cleanup_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_media_cleanup_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.event_media_cleanup_outbox TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.event_media_cleanup_outbox_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.is_event_manager(p_actor_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM public.business_account_applications
      WHERE applicant_user_id = p_actor_id AND status = 'approved'
    );
$$;
REVOKE ALL ON FUNCTION public.is_event_manager(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_event_manager(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_event_video_intent(
  p_id UUID,
  p_owner_id UUID,
  p_object_path TEXT,
  p_public_url TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT,
  p_expires_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_unfinished_count INTEGER;
  v_unfinished_bytes BIGINT;
  v_hourly_count INTEGER;
  v_media public.event_media%ROWTYPE;
BEGIN
  IF NOT public.is_event_manager(p_owner_id) THEN
    RAISE EXCEPTION 'Not authorized to manage event media'
      USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL
    OR p_object_path !~ ('^' || p_owner_id::TEXT || '/events/[0-9a-f-]+\.(mp4|webm)$')
    OR p_public_url IS NULL
    OR p_public_url = ''
    OR p_mime_type NOT IN ('video/mp4', 'video/webm')
    OR p_size_bytes IS NULL
    OR p_size_bytes <= 0
    OR p_size_bytes > 52428800
    OR p_expires_at IS NULL
    OR p_expires_at < now() + interval '2 hours'
  THEN
    RAISE EXCEPTION 'Invalid event video intent metadata'
      USING ERRCODE = '22023';
  END IF;

  -- A single owner lock serializes the count and insert. Lifecycle transitions
  -- cannot increase live usage, and cleanup-pending objects remain counted
  -- until their media row is deleted.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('event-video-intent:' || p_owner_id::TEXT, 0)
  );

  DELETE FROM public.event_video_intent_reservations
  WHERE owner_id = p_owner_id
    AND created_at <= now() - interval '1 hour';

  SELECT count(*), COALESCE(sum(size_bytes), 0)
  INTO v_unfinished_count, v_unfinished_bytes
  FROM public.event_media
  WHERE owner_id = p_owner_id
    AND kind = 'video'
    AND state IN ('pending', 'ready', 'cleanup_pending');

  SELECT count(*) INTO v_hourly_count
  FROM public.event_video_intent_reservations
  WHERE owner_id = p_owner_id
    AND created_at > now() - interval '1 hour';

  IF v_unfinished_count >= 3
    OR v_unfinished_bytes + p_size_bytes > 157286400
    OR v_hourly_count >= 10
  THEN
    RAISE EXCEPTION 'EVENT_VIDEO_INTENT_QUOTA_EXCEEDED'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.event_media (
    id, owner_id, event_id, kind, bucket, object_path, thumbnail_path,
    public_url, thumbnail_url, mime_type, size_bytes, state, expires_at
  ) VALUES (
    p_id, p_owner_id, NULL, 'video', 'event-media', p_object_path, NULL,
    p_public_url, NULL, p_mime_type, p_size_bytes, 'pending', p_expires_at
  ) RETURNING * INTO v_media;

  INSERT INTO public.event_video_intent_reservations (
    media_id, owner_id, size_bytes
  ) VALUES (p_id, p_owner_id, p_size_bytes);

  RETURN to_jsonb(v_media);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_event_video_intent(
  UUID, UUID, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_event_video_intent(
  UUID, UUID, TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ
) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_event_media_cleanup(p_media_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_media public.event_media%ROWTYPE;
  v_paths TEXT[];
  v_not_before TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_media FROM public.event_media WHERE id = p_media_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  v_paths := ARRAY[v_media.object_path];
  IF v_media.thumbnail_path IS NOT NULL THEN
    v_paths := array_append(v_paths, v_media.thumbnail_path);
  END IF;
  -- Signed upload URLs are valid for two hours in the pinned Storage SDK. The
  -- existing 24-hour video expiry is the conservative upload lease: abandon
  -- records the cleanup tombstone immediately but cannot claim it early.
  v_not_before := CASE
    WHEN v_media.kind = 'video'
      THEN GREATEST(now(), COALESCE(v_media.expires_at, now()))
    ELSE now()
  END;
  UPDATE public.event_media SET state = 'cleanup_pending', updated_at = now() WHERE id = p_media_id;
  INSERT INTO public.event_media_cleanup_outbox (
    media_id, bucket, object_paths, next_attempt_at
  ) VALUES (p_media_id, v_media.bucket, v_paths, v_not_before)
  ON CONFLICT (media_id) DO UPDATE
  SET object_paths = EXCLUDED.object_paths,
      status = CASE WHEN event_media_cleanup_outbox.status = 'completed' THEN 'completed' ELSE 'pending' END,
      next_attempt_at = CASE
        WHEN event_media_cleanup_outbox.status = 'completed'
          THEN event_media_cleanup_outbox.next_attempt_at
        ELSE GREATEST(
          event_media_cleanup_outbox.next_attempt_at,
          EXCLUDED.next_attempt_at
        )
      END,
      claimed_at = CASE
        WHEN event_media_cleanup_outbox.status = 'completed'
          THEN event_media_cleanup_outbox.claimed_at
        ELSE NULL
      END,
      updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.queue_event_media_cleanup(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_event_media_cleanup(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_owned_event_media_cleanup(p_media_id UUID, p_owner_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_state TEXT;
BEGIN
  SELECT state INTO v_state FROM public.event_media
  WHERE id = p_media_id AND owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND OR v_state NOT IN ('pending', 'ready', 'cleanup_pending', 'failed') THEN RETURN false; END IF;
  -- Always deepen a partial failure record to every persisted path. The
  -- idempotent outbox upsert prevents duplicate cleanup work.
  PERFORM public.queue_event_media_cleanup(p_media_id);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_owned_event_media_cleanup(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_owned_event_media_cleanup(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.queue_event_media_cleanup_paths(
  p_media_id UUID, p_bucket TEXT, p_object_paths TEXT[], p_last_error TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_media public.event_media%ROWTYPE;
BEGIN
  SELECT * INTO v_media FROM public.event_media WHERE id = p_media_id FOR UPDATE;
  IF NOT FOUND OR v_media.bucket <> p_bucket OR EXISTS (
    SELECT 1 FROM unnest(p_object_paths) AS supplied(path)
    WHERE supplied.path NOT IN (v_media.object_path, COALESCE(v_media.thumbnail_path, ''))
  ) THEN
    RAISE EXCEPTION 'cleanup paths do not match persisted media' USING ERRCODE = '22023';
  END IF;
  UPDATE public.event_media SET state = 'cleanup_pending', updated_at = now() WHERE id = p_media_id;
  INSERT INTO public.event_media_cleanup_outbox (media_id, bucket, object_paths, last_error)
  VALUES (p_media_id, p_bucket, p_object_paths, p_last_error)
  ON CONFLICT (media_id) DO UPDATE
  SET object_paths = (
        SELECT array_agg(DISTINCT path)
        FROM unnest(event_media_cleanup_outbox.object_paths || EXCLUDED.object_paths) AS merged(path)
      ),
      status = 'pending', next_attempt_at = now(), last_error = EXCLUDED.last_error, updated_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.queue_event_media_cleanup_paths(UUID, TEXT, TEXT[], TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_event_media_cleanup_paths(UUID, TEXT, TEXT[], TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.assert_ready_event_media(p_media_id UUID, p_actor_id UUID, p_kind TEXT)
RETURNS public.event_media LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_media public.event_media%ROWTYPE;
BEGIN
  SELECT * INTO v_media FROM public.event_media WHERE id = p_media_id FOR UPDATE;
  IF NOT FOUND OR v_media.owner_id <> p_actor_id THEN
    RAISE EXCEPTION 'Event media is unavailable for this owner' USING ERRCODE = '42501';
  END IF;
  IF v_media.kind <> p_kind OR v_media.state <> 'ready' OR v_media.event_id IS NOT NULL THEN
    RAISE EXCEPTION 'Event media must be ready, unattached, and of the requested kind' USING ERRCODE = '22023';
  END IF;
  RETURN v_media;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_ready_event_media(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_ready_event_media(UUID, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.create_forum_event_with_media(
  p_actor_id UUID,
  p_event JSONB,
  p_idempotency_key UUID,
  p_request_fingerprint TEXT,
  p_image_media_id UUID DEFAULT NULL,
  p_video_media_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_image public.event_media%ROWTYPE;
  v_video public.event_media%ROWTYPE;
  v_event public.forum_events%ROWTYPE;
  v_request public.forum_event_create_requests%ROWTYPE;
BEGIN
  IF NOT public.is_event_manager(p_actor_id) THEN
    RAISE EXCEPTION 'Not authorized to manage events' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR
    p_idempotency_key::TEXT !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    p_request_fingerprint IS NULL OR
    p_request_fingerprint !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'Invalid event idempotency metadata' USING ERRCODE = '22023';
  END IF;

  -- Serialize the claim before touching ready media. Exact replays therefore
  -- return the original event even though its media is already attached.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_actor_id::TEXT || ':' || p_idempotency_key::TEXT, 0)
  );
  SELECT * INTO v_request
  FROM public.forum_event_create_requests
  WHERE actor_id = p_actor_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_request.request_fingerprint <> p_request_fingerprint THEN
      RAISE EXCEPTION 'Idempotency key was already used for another event request'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_request.response_payload;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') INTO v_is_admin;
  PERFORM id FROM public.event_media WHERE id IN (p_image_media_id, p_video_media_id) ORDER BY id FOR UPDATE;
  IF p_image_media_id IS NOT NULL THEN
    v_image := public.assert_ready_event_media(p_image_media_id, p_actor_id, 'image');
  END IF;
  IF p_video_media_id IS NOT NULL THEN
    v_video := public.assert_ready_event_media(p_video_media_id, p_actor_id, 'video');
  END IF;
  INSERT INTO public.forum_events (
    title, slug, description, location, event_date, image_url, video_url,
    host_id, category_id, is_published, created_by
  ) VALUES (
    p_event->>'title', p_event->>'slug', NULLIF(p_event->>'description', ''),
    NULLIF(p_event->>'location', ''), (p_event->>'event_date')::TIMESTAMPTZ,
    CASE WHEN p_image_media_id IS NULL THEN NULL ELSE v_image.public_url END,
    CASE WHEN p_video_media_id IS NULL THEN NULL ELSE v_video.public_url END,
    CASE WHEN v_is_admin THEN NULLIF(p_event->>'host_id', '')::UUID ELSE p_actor_id END,
    NULLIF(p_event->>'category_id', '')::UUID,
    CASE WHEN v_is_admin THEN COALESCE((p_event->>'is_published')::BOOLEAN, true) ELSE false END,
    p_actor_id
  ) RETURNING * INTO v_event;
  UPDATE public.event_media
  SET event_id = v_event.id, state = 'attached', expires_at = NULL, updated_at = now()
  WHERE id IN (p_image_media_id, p_video_media_id);
  INSERT INTO public.forum_event_create_requests (
    actor_id, idempotency_key, request_fingerprint, event_id, response_payload
  ) VALUES (
    p_actor_id,
    p_idempotency_key,
    p_request_fingerprint,
    v_event.id,
    to_jsonb(v_event)
  );
  RETURN to_jsonb(v_event);
END;
$$;
REVOKE ALL ON FUNCTION public.create_forum_event_with_media(UUID, JSONB, UUID, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_forum_event_with_media(UUID, JSONB, UUID, TEXT, UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.update_forum_event_with_media(
  p_actor_id UUID, p_event_id UUID, p_updates JSONB,
  p_replace_image BOOLEAN DEFAULT false, p_image_media_id UUID DEFAULT NULL,
  p_replace_video BOOLEAN DEFAULT false, p_video_media_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_event public.forum_events%ROWTYPE;
  v_image public.event_media%ROWTYPE;
  v_video public.event_media%ROWTYPE;
  v_old public.event_media%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.forum_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Event not found' USING ERRCODE = 'P0002'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') INTO v_is_admin;
  IF NOT public.is_event_manager(p_actor_id) OR (
    NOT v_is_admin AND (
      v_event.is_published OR
      (v_event.host_id IS DISTINCT FROM p_actor_id AND v_event.created_by IS DISTINCT FROM p_actor_id)
    )
  ) THEN RAISE EXCEPTION 'Not authorized to update event' USING ERRCODE = '42501'; END IF;
  IF NOT v_is_admin AND COALESCE((p_updates->>'is_published')::BOOLEAN, false) THEN
    RAISE EXCEPTION 'Only admins can publish events' USING ERRCODE = '42501';
  END IF;
  PERFORM id FROM public.event_media WHERE id IN (p_image_media_id, p_video_media_id) ORDER BY id FOR UPDATE;
  IF p_replace_image AND p_image_media_id IS NOT NULL THEN
    v_image := public.assert_ready_event_media(p_image_media_id, p_actor_id, 'image');
  END IF;
  IF p_replace_video AND p_video_media_id IS NOT NULL THEN
    v_video := public.assert_ready_event_media(p_video_media_id, p_actor_id, 'video');
  END IF;
  IF p_replace_image THEN
    FOR v_old IN SELECT * FROM public.event_media
      WHERE event_id = p_event_id AND kind = 'image' AND state = 'attached' FOR UPDATE
    LOOP PERFORM public.queue_event_media_cleanup(v_old.id); END LOOP;
  END IF;
  IF p_replace_video THEN
    FOR v_old IN SELECT * FROM public.event_media
      WHERE event_id = p_event_id AND kind = 'video' AND state = 'attached' FOR UPDATE
    LOOP PERFORM public.queue_event_media_cleanup(v_old.id); END LOOP;
  END IF;
  UPDATE public.forum_events
  SET title = CASE WHEN p_updates ? 'title' THEN p_updates->>'title' ELSE title END,
      description = CASE WHEN p_updates ? 'description' THEN NULLIF(p_updates->>'description', '') ELSE description END,
      location = CASE WHEN p_updates ? 'location' THEN NULLIF(p_updates->>'location', '') ELSE location END,
      event_date = CASE WHEN p_updates ? 'event_date' THEN (p_updates->>'event_date')::TIMESTAMPTZ ELSE event_date END,
      host_id = CASE WHEN v_is_admin AND p_updates ? 'host_id' THEN NULLIF(p_updates->>'host_id', '')::UUID ELSE host_id END,
      category_id = CASE WHEN p_updates ? 'category_id' THEN NULLIF(p_updates->>'category_id', '')::UUID ELSE category_id END,
      is_published = CASE WHEN p_updates ? 'is_published' THEN (p_updates->>'is_published')::BOOLEAN ELSE is_published END,
      image_url = CASE WHEN p_replace_image THEN CASE WHEN p_image_media_id IS NULL THEN NULL ELSE v_image.public_url END ELSE image_url END,
      video_url = CASE WHEN p_replace_video THEN CASE WHEN p_video_media_id IS NULL THEN NULL ELSE v_video.public_url END ELSE video_url END
  WHERE id = p_event_id RETURNING * INTO v_event;
  UPDATE public.event_media SET event_id = p_event_id, state = 'attached', expires_at = NULL, updated_at = now()
  WHERE id IN (
    CASE WHEN p_replace_image THEN p_image_media_id END,
    CASE WHEN p_replace_video THEN p_video_media_id END
  );
  RETURN to_jsonb(v_event);
END;
$$;
REVOKE ALL ON FUNCTION public.update_forum_event_with_media(UUID, UUID, JSONB, BOOLEAN, UUID, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_forum_event_with_media(UUID, UUID, JSONB, BOOLEAN, UUID, BOOLEAN, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_forum_event_with_media(p_actor_id UUID, p_event_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_event public.forum_events%ROWTYPE;
  v_media public.event_media%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.forum_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') INTO v_is_admin;
  IF NOT public.is_event_manager(p_actor_id) OR (
    NOT v_is_admin AND (
      v_event.is_published OR
      (v_event.host_id IS DISTINCT FROM p_actor_id AND v_event.created_by IS DISTINCT FROM p_actor_id)
    )
  ) THEN RAISE EXCEPTION 'Not authorized to delete event' USING ERRCODE = '42501'; END IF;
  FOR v_media IN SELECT * FROM public.event_media
    WHERE event_id = p_event_id AND state = 'attached' ORDER BY id FOR UPDATE
  LOOP PERFORM public.queue_event_media_cleanup(v_media.id); END LOOP;
  DELETE FROM public.forum_events WHERE id = p_event_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_forum_event_with_media(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_forum_event_with_media(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_expired_event_media(p_batch_size INTEGER DEFAULT 50)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_media RECORD; v_count INTEGER := 0;
BEGIN
  FOR v_media IN SELECT id FROM public.event_media
    WHERE state IN ('pending', 'ready') AND expires_at <= now()
    ORDER BY expires_at, id LIMIT LEAST(GREATEST(p_batch_size, 1), 100) FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.queue_event_media_cleanup(v_media.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_expired_event_media(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_expired_event_media(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_event_media_cleanup(p_batch_size INTEGER DEFAULT 20)
RETURNS TABLE (id BIGINT, media_id UUID, bucket TEXT, object_paths TEXT[], attempts INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT o.id
    FROM public.event_media_cleanup_outbox o
    LEFT JOIN public.event_media m ON m.id = o.media_id
    WHERE (
        o.status IN ('pending', 'failed')
        OR (o.status = 'processing' AND o.claimed_at < now() - interval '10 minutes')
      )
      AND o.next_attempt_at <= now()
      AND (o.media_id IS NULL OR m.state = 'cleanup_pending')
    ORDER BY o.next_attempt_at, o.id
    LIMIT LEAST(GREATEST(p_batch_size, 1), 50)
    FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE public.event_media_cleanup_outbox o
  SET status = 'processing', attempts = o.attempts + 1, claimed_at = now(), updated_at = now()
  FROM claimable WHERE o.id = claimable.id
  RETURNING o.id, o.media_id, o.bucket, o.object_paths, o.attempts;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_event_media_cleanup(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_event_media_cleanup(INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_event_media_cleanup(
  p_id BIGINT, p_success BOOLEAN, p_error TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_media_id UUID;
  v_status TEXT;
BEGIN
  SELECT media_id, status INTO v_media_id, v_status
  FROM public.event_media_cleanup_outbox
  WHERE id = p_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  -- Completion is idempotent, and a late worker must not resurrect a cleanup
  -- already completed by a newer claim.
  IF v_status = 'completed' THEN RETURN; END IF;
  IF p_success THEN
    UPDATE public.event_media_cleanup_outbox
    SET status = 'completed', completed_at = now(), last_error = NULL, updated_at = now() WHERE id = p_id;
    DELETE FROM public.event_media WHERE id = v_media_id AND state = 'cleanup_pending';
  ELSE
    UPDATE public.event_media_cleanup_outbox
    SET status = 'pending',
        next_attempt_at = now() + make_interval(
          secs => LEAST(
            3600,
            30 * power(2, LEAST(GREATEST(attempts - 1, 0), 7))
          )
        ),
        claimed_at = NULL,
        last_error = LEFT(COALESCE(p_error, 'unknown cleanup error'), 2000),
        updated_at = now()
    WHERE id = p_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_event_media_cleanup(BIGINT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_event_media_cleanup(BIGINT, BOOLEAN, TEXT) TO service_role;

-- The repository already provisions pg_cron/pg_net and vault secrets named
-- project_url and cron_secret. This schedules only the new cleanup worker.
SELECT cron.schedule(
  'process-event-media-cleanup', '* * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/process-event-media-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := jsonb_build_object('triggered_at', now()), timeout_milliseconds := 55000
  );
  $$
);
