-- Existing rows retain their historical completed meaning. Never replay them
-- automatically: the old schema cannot distinguish crashes from success.
ALTER TABLE public.processed_stripe_events
    ADD COLUMN completed_at TIMESTAMPTZ,
    ADD COLUMN processing_token UUID,
    ADD COLUMN lease_expires_at TIMESTAMPTZ;

UPDATE public.processed_stripe_events SET completed_at = processed_at;
ALTER TABLE public.processed_stripe_events
    ALTER COLUMN completed_at SET DEFAULT NOW(),
    ADD CONSTRAINT stripe_event_delivery_state CHECK (
        (completed_at IS NOT NULL AND processing_token IS NULL AND lease_expires_at IS NULL)
        OR (completed_at IS NULL AND processing_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    );

CREATE FUNCTION public.claim_stripe_event_delivery(p_event_id TEXT, p_token UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p_event_id IS NULL OR btrim(p_event_id) = '' OR p_token IS NULL THEN
        RAISE EXCEPTION 'Event id and processing token are required';
    END IF;
    INSERT INTO public.processed_stripe_events AS events
        (event_id, completed_at, processing_token, lease_expires_at)
    VALUES (p_event_id, NULL, p_token, clock_timestamp() + INTERVAL '5 minutes')
    ON CONFLICT (event_id) DO UPDATE
        SET processing_token = EXCLUDED.processing_token,
            lease_expires_at = clock_timestamp() + INTERVAL '5 minutes'
        WHERE events.completed_at IS NULL AND events.lease_expires_at <= clock_timestamp();
    IF FOUND THEN RETURN 'claimed'; END IF;
    IF EXISTS (SELECT 1 FROM public.processed_stripe_events
               WHERE event_id = p_event_id AND completed_at IS NOT NULL) THEN
        RETURN 'completed';
    END IF;
    RETURN 'busy';
END;
$$;

CREATE FUNCTION public.complete_stripe_event_delivery(p_event_id TEXT, p_token UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.processed_stripe_events
    SET completed_at = clock_timestamp(), processed_at = clock_timestamp(),
        processing_token = NULL, lease_expires_at = NULL
    WHERE event_id = p_event_id AND processing_token = p_token
        AND completed_at IS NULL AND lease_expires_at > clock_timestamp();
    RETURN FOUND;
END;
$$;

CREATE FUNCTION public.release_stripe_event_delivery(p_event_id TEXT, p_token UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.processed_stripe_events SET lease_expires_at = '-infinity'
    WHERE event_id = p_event_id AND processing_token = p_token AND completed_at IS NULL;
END;
$$;

-- Retain unresolved events for investigation even beyond the normal retention.
CREATE OR REPLACE FUNCTION public.purge_old_stripe_events()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    DELETE FROM public.processed_stripe_events
    WHERE completed_at < NOW() - INTERVAL '30 days';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_stripe_event_delivery(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_stripe_event_delivery(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_stripe_event_delivery(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stripe_event_delivery(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_stripe_event_delivery(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_stripe_event_delivery(TEXT, UUID) TO service_role;
