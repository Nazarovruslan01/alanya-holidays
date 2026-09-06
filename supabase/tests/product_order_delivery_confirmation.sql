-- Run after catalog, stock, reservation, and delivery/payment migrations.
-- All fixtures and assertions are rolled back.
BEGIN;

DO $verification$
DECLARE
    v_product_id BIGINT;
    v_items JSONB;
    v_payload JSONB;
    v_order_id BIGINT;
    v_online_order_id BIGINT;
    v_margin_order_id BIGINT;
    v_late_order_id BIGINT;
    v_response JSONB;
    v_begin JSONB;
    v_stock INTEGER;
    v_failed BOOLEAN;
    v_quote_time TIMESTAMPTZ;
    v_session_expiry TIMESTAMPTZ;
    v_payment_outcome TEXT;
BEGIN
    INSERT INTO public.product_items (name, price, currency, stock, status)
    VALUES ('Delivery verification product', 25, 'EUR', 10, 'active')
    RETURNING id INTO v_product_id;

    v_items := jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id::TEXT, 'product_name', 'Delivery verification product',
        'sku_id', NULL, 'quantity', 1, 'unit_price', 25,
        'final_price', 25, 'subtotal', 25
    ));
    v_payload := jsonb_build_object(
        'currency', 'EUR', 'subtotal', 25, 'customerNotes', NULL,
        'recipient', jsonb_build_object(
            'name', 'Guest', 'email', 'guest@example.com',
            'phone', '+905551234567', 'address', '10 Harbour Road',
            'contact_method', 'email'
        ),
        'items', v_items
    );

    v_response := public.create_product_order(
        'EUR', 25, NULL, NULL, v_payload->'recipient', v_items,
        '10000000-0000-4000-8000-000000000001', v_payload,
        repeat('a', 64)
    );
    v_order_id := (v_response->>'data')::BIGINT;
    IF NOT EXISTS (
        SELECT 1 FROM public.order_headers WHERE id = v_order_id
          AND payment_provider = 'unselected'
          AND guest_access_token_hash = repeat('a', 64)
          AND delivery_quote_confirmed_at IS NULL
    ) THEN RAISE EXCEPTION 'guest order capability or initial payment state missing'; END IF;

    v_failed := FALSE;
    BEGIN
        PERFORM public.select_product_order_manual_payment(v_order_id);
    EXCEPTION WHEN raise_exception THEN
        v_failed := SQLERRM = 'Payment requires a confirmed delivery quote';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'payment was selectable before quote'; END IF;

    v_response := public.confirm_product_order_delivery_quote(v_order_id, 5.50, 'Tomorrow 10-12');
    IF (v_response->>'total_amount')::NUMERIC <> 30.50 THEN
        RAISE EXCEPTION 'server total did not include delivery fee';
    END IF;
    PERFORM public.confirm_product_order_delivery_quote(v_order_id, 5.50, 'Tomorrow 10-12');
    v_failed := FALSE;
    BEGIN
        PERFORM public.confirm_product_order_delivery_quote(v_order_id, 6, 'Tomorrow 10-12');
    EXCEPTION WHEN raise_exception THEN v_failed := SQLERRM = 'Delivery quote is immutable'; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'changed quote retry was accepted'; END IF;

    PERFORM public.select_product_order_manual_payment(v_order_id);
    PERFORM public.select_product_order_manual_payment(v_order_id);
    v_failed := FALSE;
    BEGIN PERFORM public.begin_product_order_online_payment(v_order_id);
    EXCEPTION WHEN raise_exception THEN v_failed := SQLERRM = 'Payment method was already selected'; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'manual order switched to Stripe'; END IF;
    PERFORM public.transition_product_order_status(v_order_id, 'pending_payment', 'paid');

    -- A first Stripe selection needs enough margin for API latency and Stripe's
    -- 30-minute minimum. Rejection must leave manual payment available.
    v_response := public.create_product_order(
        'EUR', 25, NULL, NULL, v_payload->'recipient', v_items,
        '10000000-0000-4000-8000-000000000004', v_payload,
        repeat('e', 64)
    );
    v_margin_order_id := (v_response->>'data')::BIGINT;
    PERFORM public.confirm_product_order_delivery_quote(v_margin_order_id, 0, 'Tomorrow');
    UPDATE public.order_headers SET reservation_expires_at = now() + INTERVAL '34 minutes'
    WHERE id = v_margin_order_id;
    v_failed := FALSE;
    BEGIN PERFORM public.begin_product_order_online_payment(v_margin_order_id);
    EXCEPTION WHEN raise_exception THEN
        v_failed := SQLERRM = 'Order reservation has too little time for online payment';
    END;
    IF NOT v_failed OR EXISTS (
        SELECT 1 FROM public.order_headers WHERE id = v_margin_order_id
          AND payment_provider <> 'unselected'
    ) THEN RAISE EXCEPTION 'unsafe first Stripe selection changed payment choice'; END IF;
    PERFORM public.select_product_order_manual_payment(v_margin_order_id);

    -- A separately locked order chooses Stripe once and cannot be manually paid
    -- or cancelled while its Checkout Session can still accept payment.
    v_response := public.create_product_order(
        'EUR', 25, NULL, NULL, v_payload->'recipient', v_items,
        '10000000-0000-4000-8000-000000000002', v_payload,
        repeat('b', 64)
    );
    v_online_order_id := (v_response->>'data')::BIGINT;
    v_response := public.confirm_product_order_delivery_quote(v_online_order_id, 5, 'Tomorrow');
    v_quote_time := (v_response->>'delivery_quote_confirmed_at')::TIMESTAMPTZ;
    v_begin := public.begin_product_order_online_payment(v_online_order_id);
    v_session_expiry := (v_begin->>'checkout_expires_at')::TIMESTAMPTZ;
    PERFORM public.attach_product_order_checkout_session(
        v_online_order_id, 'cs_delivery_verification', v_session_expiry
    );
    v_begin := public.begin_product_order_online_payment(v_online_order_id);
    IF (v_begin->>'checkout_expires_at')::TIMESTAMPTZ IS DISTINCT FROM v_session_expiry THEN
        RAISE EXCEPTION 'Stripe retry did not preserve the existing session expiry';
    END IF;
    v_failed := FALSE;
    BEGIN PERFORM public.transition_product_order_status(v_online_order_id, 'pending_payment', 'paid');
    EXCEPTION WHEN raise_exception THEN
        v_failed := SQLERRM = 'Payment requires a confirmed manual payment choice';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'Stripe order was manually marked paid'; END IF;
    v_failed := FALSE;
    BEGIN PERFORM public.transition_product_order_status(v_online_order_id, 'pending_payment', 'cancelled');
    EXCEPTION WHEN raise_exception THEN
        v_failed := SQLERRM = 'Cannot cancel an order with a payable or paid Stripe payment';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'payable Stripe order released stock'; END IF;

    v_payment_outcome := public.confirm_product_order_stripe_payment(
        v_online_order_id, 'cs_delivery_verification', 31, 'EUR', v_quote_time, 'pi_mismatch'
    );
    IF v_payment_outcome <> 'mismatch' OR NOT EXISTS (
        SELECT 1 FROM public.order_headers WHERE id = v_online_order_id
          AND status = 'pending_payment' AND payment_reconciliation_status = 'mismatch'
    ) THEN RAISE EXCEPTION 'amount mismatch was not quarantined'; END IF;
    v_payment_outcome := public.confirm_product_order_stripe_payment(
        v_online_order_id, 'cs_delivery_verification', 30, 'EUR', v_quote_time, 'pi_online'
    );
    IF v_payment_outcome <> 'paid' OR NOT EXISTS (
        SELECT 1 FROM public.order_headers WHERE id = v_online_order_id
          AND status = 'paid' AND reservation_expires_at IS NULL
          AND payment_reconciliation_status = 'none'
    ) THEN RAISE EXCEPTION 'matching signed payment did not settle order'; END IF;

    -- A verified payment arriving after an exact-once release is visible for
    -- reconciliation, but never re-reserves inventory or marks the order paid.
    v_response := public.create_product_order(
        'EUR', 25, NULL, NULL, v_payload->'recipient', v_items,
        '10000000-0000-4000-8000-000000000003', v_payload,
        repeat('c', 64)
    );
    v_late_order_id := (v_response->>'data')::BIGINT;
    v_response := public.confirm_product_order_delivery_quote(v_late_order_id, 0, 'Tomorrow');
    v_quote_time := (v_response->>'delivery_quote_confirmed_at')::TIMESTAMPTZ;
    v_begin := public.begin_product_order_online_payment(v_late_order_id);
    v_session_expiry := (v_begin->>'checkout_expires_at')::TIMESTAMPTZ;
    PERFORM public.attach_product_order_checkout_session(
        v_late_order_id, 'cs_late_verification', v_session_expiry
    );
    UPDATE public.order_headers SET stripe_session_expires_at = now() - INTERVAL '1 second'
    WHERE id = v_late_order_id;
    PERFORM public.transition_product_order_status(v_late_order_id, 'pending_payment', 'cancelled');
    SELECT stock INTO v_stock FROM public.product_items WHERE id = v_product_id;
    v_payment_outcome := public.confirm_product_order_stripe_payment(
        v_late_order_id, 'cs_late_verification', 25, 'EUR', v_quote_time, 'pi_late'
    );
    IF v_payment_outcome <> 'late_payment' OR NOT EXISTS (
        SELECT 1 FROM public.order_headers WHERE id = v_late_order_id
          AND status = 'cancelled' AND reservation_state = 'released'
          AND payment_reconciliation_status = 'late_payment'
    ) THEN RAISE EXCEPTION 'late payment was not quarantined'; END IF;
    IF (SELECT stock FROM public.product_items WHERE id = v_product_id) <> v_stock THEN
        RAISE EXCEPTION 'late payment changed inventory';
    END IF;

    v_failed := FALSE;
    BEGIN
        PERFORM public.get_product_order_replay(
            '10000000-0000-4000-8000-000000000003', NULL, v_payload, repeat('d', 64)
        );
    EXCEPTION WHEN unique_violation THEN v_failed := SQLERRM = 'Idempotency key conflict'; END;
    IF NOT v_failed THEN RAISE EXCEPTION 'neighbor guest capability replay leaked an order'; END IF;
END;
$verification$;

ROLLBACK;
