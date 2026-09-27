-- Disposable/local database only; run after migrations. Fixtures roll back.
BEGIN;
DO $$
DECLARE
    a UUID := '11111111-1111-4111-8111-111111111111';
    b UUID := '22222222-2222-4222-8222-222222222222';
BEGIN
    ASSERT public.claim_stripe_event_delivery('evt_lease_test', a) = 'claimed';
    ASSERT public.claim_stripe_event_delivery('evt_lease_test', b) = 'busy';
    ASSERT NOT public.complete_stripe_event_delivery('evt_lease_test', b);
    PERFORM public.release_stripe_event_delivery('evt_lease_test', b);
    ASSERT public.claim_stripe_event_delivery('evt_lease_test', b) = 'busy';

    -- Process died: no release call. Expire its lease to simulate elapsed time.
    UPDATE public.processed_stripe_events SET lease_expires_at = NOW() - INTERVAL '1 second'
    WHERE event_id = 'evt_lease_test';
    ASSERT NOT public.complete_stripe_event_delivery('evt_lease_test', a);
    ASSERT public.claim_stripe_event_delivery('evt_lease_test', b) = 'claimed';
    ASSERT NOT public.complete_stripe_event_delivery('evt_lease_test', a);
    PERFORM public.release_stripe_event_delivery('evt_lease_test', a);
    ASSERT public.claim_stripe_event_delivery('evt_lease_test', a) = 'busy';
    ASSERT public.complete_stripe_event_delivery('evt_lease_test', b);
    PERFORM public.release_stripe_event_delivery('evt_lease_test', b);
    ASSERT public.claim_stripe_event_delivery('evt_lease_test', a) = 'completed';

    -- Handler failure releases immediately; a retry does not wait five minutes.
    ASSERT public.claim_stripe_event_delivery('evt_release_test', a) = 'claimed';
    PERFORM public.release_stripe_event_delivery('evt_release_test', a);
    ASSERT public.claim_stripe_event_delivery('evt_release_test', b) = 'claimed';

    -- Legacy callers remain deduplicated. Unresolved events survive retention.
    ASSERT public.claim_stripe_event('evt_legacy_test');
    ASSERT public.claim_stripe_event_delivery('evt_legacy_test', a) = 'completed';
    UPDATE public.processed_stripe_events SET processed_at = NOW() - INTERVAL '31 days'
    WHERE event_id = 'evt_release_test';
    UPDATE public.processed_stripe_events SET completed_at = NOW() - INTERVAL '31 days'
    WHERE event_id = 'evt_legacy_test';
    PERFORM public.purge_old_stripe_events();
    ASSERT EXISTS (SELECT 1 FROM public.processed_stripe_events WHERE event_id = 'evt_release_test');
    ASSERT NOT EXISTS (SELECT 1 FROM public.processed_stripe_events WHERE event_id = 'evt_legacy_test');

    ASSERT NOT has_function_privilege('anon', 'public.claim_stripe_event_delivery(text,uuid)', 'EXECUTE');
    ASSERT NOT has_function_privilege('authenticated', 'public.claim_stripe_event_delivery(text,uuid)', 'EXECUTE');
    ASSERT NOT has_function_privilege('anon', 'public.complete_stripe_event_delivery(text,uuid)', 'EXECUTE');
    ASSERT NOT has_function_privilege('authenticated', 'public.release_stripe_event_delivery(text,uuid)', 'EXECUTE');
    ASSERT has_function_privilege('service_role', 'public.claim_stripe_event_delivery(text,uuid)', 'EXECUTE');
END;
$$;
SET LOCAL ROLE service_role;
SELECT public.claim_stripe_event_delivery('evt_role_test', '11111111-1111-4111-8111-111111111111');
SELECT public.complete_stripe_event_delivery('evt_role_test', '11111111-1111-4111-8111-111111111111');
ROLLBACK;
