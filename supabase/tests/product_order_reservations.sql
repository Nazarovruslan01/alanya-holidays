-- Run against a disposable/local database after applying migrations.
-- Every fixture and assertion is rolled back.
BEGIN;

DO $verification$
DECLARE
    v_product_id BIGINT;
    v_other_product_id BIGINT;
    v_sku_id BIGINT;
    v_order_id BIGINT;
    v_paid_order_id BIGINT;
    v_expiring_order_id BIGINT;
    v_legacy_order_id BIGINT;
    v_response JSONB;
    v_retry JSONB;
    v_items JSONB;
    v_request_payload JSONB;
    v_stock INTEGER;
    v_count INTEGER;
    v_conflict BOOLEAN;
BEGIN
    INSERT INTO public.product_items (name, price, currency, stock, status)
    VALUES ('Lifecycle verification product', 25, 'EUR', 10, 'active')
    RETURNING id INTO v_product_id;

    INSERT INTO public.product_items (name, price, currency, stock, status)
    VALUES ('Other lifecycle product', 30, 'EUR', 10, 'active')
    RETURNING id INTO v_other_product_id;

    INSERT INTO public.product_skus (product_id, label, options, price, stock)
    VALUES (v_product_id, 'Blue', '{}'::JSONB, 25, 5)
    RETURNING id INTO v_sku_id;

    v_items := jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id::TEXT,
        'product_name', 'Lifecycle verification product',
        'sku_id', NULL,
        'sku_label', NULL,
        'quantity', 2,
        'unit_price', 25,
        'final_price', 25,
        'subtotal', 50
    ));
    v_request_payload := jsonb_build_object(
        'currency', 'EUR',
        'subtotal', 50,
        'customerNotes', NULL,
        'recipient', jsonb_build_object('name', 'Guest', 'email', 'guest@example.com'),
        'items', v_items
    );

    v_response := public.create_product_order(
        'EUR', 50, NULL, NULL,
        jsonb_build_object('name', 'Guest', 'email', 'guest@example.com'),
        v_items,
        '11111111-1111-4111-8111-111111111111',
        v_request_payload
    );
    v_order_id := (v_response->>'data')::BIGINT;

    IF v_response->>'status' <> 'pending_payment' THEN
        RAISE EXCEPTION 'new order status was not pending_payment';
    END IF;
    IF (v_response->>'expires_at')::TIMESTAMPTZ NOT BETWEEN
       now() + INTERVAL '23 hours 59 minutes'
       AND now() + INTERVAL '24 hours 1 minute' THEN
        RAISE EXCEPTION 'new order reservation did not receive a 24-hour expiry';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.order_headers
        WHERE id = v_order_id
          AND reservation_state = 'reserved'
          AND request_fingerprint IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'new order reservation metadata is incomplete';
    END IF;
    SELECT stock INTO v_stock FROM public.product_items WHERE id = v_product_id;
    IF v_stock <> 8 THEN
        RAISE EXCEPTION 'initial reservation did not decrement stock exactly once';
    END IF;

    v_retry := public.create_product_order(
        'EUR', 50, NULL, NULL,
        jsonb_build_object('name', 'Guest', 'email', 'guest@example.com'),
        v_items,
        '11111111-1111-4111-8111-111111111111',
        v_request_payload
    );
    IF (v_retry->>'data')::BIGINT <> v_order_id THEN
        RAISE EXCEPTION 'same idempotency request did not return the same order';
    END IF;
    SELECT stock INTO v_stock FROM public.product_items WHERE id = v_product_id;
    IF v_stock <> 8 THEN
        RAISE EXCEPTION 'idempotent retry decremented stock twice';
    END IF;

    v_retry := public.get_product_order_replay(
        '11111111-1111-4111-8111-111111111111',
        NULL,
        v_request_payload
    );
    IF (v_retry->>'data')::BIGINT <> v_order_id THEN
        RAISE EXCEPTION 'preflight replay did not return the original order';
    END IF;

    v_conflict := FALSE;
    BEGIN
        PERFORM public.get_product_order_replay(
            '11111111-1111-4111-8111-111111111111',
            NULL,
            v_request_payload || jsonb_build_object('subtotal', 51)
        );
    EXCEPTION WHEN unique_violation THEN
        v_conflict := SQLERRM = 'Idempotency key conflict';
    END;
    IF NOT v_conflict THEN
        RAISE EXCEPTION 'changed idempotency payload was not rejected generically';
    END IF;

    v_conflict := FALSE;
    BEGIN
        PERFORM public.get_product_order_replay(
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            v_request_payload
        );
    EXCEPTION WHEN unique_violation THEN
        v_conflict := SQLERRM = 'Idempotency key conflict';
    END;
    IF NOT v_conflict THEN
        RAISE EXCEPTION 'cross-owner idempotency replay was not rejected generically';
    END IF;

    PERFORM public.transition_product_order_status(
        v_order_id, 'pending_payment', 'cancelled'
    );
    SELECT stock INTO v_stock FROM public.product_items WHERE id = v_product_id;
    IF v_stock <> 10 OR NOT EXISTS (
        SELECT 1 FROM public.order_headers
        WHERE id = v_order_id
          AND status = 'cancelled'
          AND reservation_state = 'released'
          AND reservation_expires_at IS NULL
    ) THEN
        RAISE EXCEPTION 'cancellation did not release stock exactly once';
    END IF;
    IF public.transition_product_order_status(
        v_order_id, 'pending_payment', 'cancelled'
    ) IS NOT NULL THEN
        RAISE EXCEPTION 'stale duplicate cancellation was accepted';
    END IF;
    SELECT stock INTO v_stock FROM public.product_items WHERE id = v_product_id;
    IF v_stock <> 10 THEN
        RAISE EXCEPTION 'duplicate cancellation released stock twice';
    END IF;

    -- Paid reservations stop expiring, but a valid paid cancellation still
    -- restores stock before fulfillment commits it.
    v_response := public.create_product_order(
        'EUR', 25, NULL, NULL,
        jsonb_build_object('name', 'Guest', 'email', 'guest@example.com'),
        jsonb_build_array(jsonb_build_object(
            'product_id', v_product_id::TEXT,
            'product_name', 'Lifecycle verification product',
            'sku_id', NULL,
            'quantity', 1,
            'unit_price', 25,
            'final_price', 25,
            'subtotal', 25
        )),
        '33333333-3333-4333-8333-333333333333',
        jsonb_build_object('request', 'paid-order')
    );
    v_paid_order_id := (v_response->>'data')::BIGINT;
    PERFORM public.transition_product_order_status(
        v_paid_order_id, 'pending_payment', 'paid'
    );
    IF (SELECT reservation_expires_at IS NOT NULL FROM public.order_headers
        WHERE id = v_paid_order_id) THEN
        RAISE EXCEPTION 'paid order retained an expiry';
    END IF;
    SELECT public.expire_pending_product_orders(now() + INTERVAL '2 days')
    INTO v_count;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'paid order was expired';
    END IF;

    v_conflict := FALSE;
    BEGIN
        PERFORM public.transition_product_order_status(
            v_paid_order_id, 'paid', 'completed'
        );
    EXCEPTION WHEN raise_exception THEN
        v_conflict := SQLERRM = 'Invalid order status transition';
    END;
    IF NOT v_conflict THEN
        RAISE EXCEPTION 'invalid transition was accepted';
    END IF;
    SELECT stock INTO v_stock FROM public.product_items WHERE id = v_product_id;
    IF v_stock <> 9 THEN
        RAISE EXCEPTION 'invalid transition changed reserved stock';
    END IF;
    PERFORM public.transition_product_order_status(
        v_paid_order_id, 'paid', 'cancelled'
    );
    SELECT stock INTO v_stock FROM public.product_items WHERE id = v_product_id;
    IF v_stock <> 10 THEN
        RAISE EXCEPTION 'paid cancellation did not restore reserved stock';
    END IF;

    -- Expiration releases once and changes status to the read-compatible raw
    -- string "expired".
    v_response := public.create_product_order(
        'EUR', 75, NULL, NULL,
        jsonb_build_object('name', 'Guest', 'email', 'guest@example.com'),
        jsonb_build_array(jsonb_build_object(
            'product_id', v_product_id::TEXT,
            'product_name', 'Lifecycle verification product',
            'sku_id', NULL,
            'quantity', 3,
            'unit_price', 25,
            'final_price', 25,
            'subtotal', 75
        )),
        '44444444-4444-4444-8444-444444444444',
        jsonb_build_object('request', 'expiring-order')
    );
    v_expiring_order_id := (v_response->>'data')::BIGINT;
    UPDATE public.order_headers
    SET reservation_expires_at = now() - INTERVAL '1 second'
    WHERE id = v_expiring_order_id;
    SELECT public.expire_pending_product_orders() INTO v_count;
    IF v_count <> 1 OR NOT EXISTS (
        SELECT 1 FROM public.order_headers
        WHERE id = v_expiring_order_id
          AND status = 'expired'
          AND reservation_state = 'released'
    ) THEN
        RAISE EXCEPTION 'pending reservation did not expire';
    END IF;
    SELECT stock INTO v_stock FROM public.product_items WHERE id = v_product_id;
    IF v_stock <> 10 THEN
        RAISE EXCEPTION 'expiration did not restore stock';
    END IF;
    SELECT public.expire_pending_product_orders() INTO v_count;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'expiration released the same order twice';
    END IF;

    -- Legacy rows can transition, but unknown historical reservation state is
    -- never used to credit inventory.
    INSERT INTO public.order_headers (
        currency, status, subtotal_items, recipient
    ) VALUES ('EUR', 'pending_payment', 50, '{}'::JSONB)
    RETURNING id INTO v_legacy_order_id;
    INSERT INTO public.order_items (
        order_id, product_id, product_name, quantity,
        unit_price, final_price, subtotal
    ) VALUES (
        v_legacy_order_id, v_product_id::TEXT, 'Legacy item', 2,
        25, 25, 50
    );
    PERFORM public.transition_product_order_status(
        v_legacy_order_id, 'pending_payment', 'cancelled'
    );
    SELECT stock INTO v_stock FROM public.product_items WHERE id = v_product_id;
    IF v_stock <> 10 OR NOT EXISTS (
        SELECT 1 FROM public.order_headers
        WHERE id = v_legacy_order_id AND reservation_state = 'legacy_unknown'
    ) THEN
        RAISE EXCEPTION 'legacy cancellation credited unknown historical stock';
    END IF;

    -- The database rejects fractional quantities and SKU/product mismatches
    -- atomically, leaving stock unchanged.
    v_conflict := FALSE;
    BEGIN
        PERFORM public.create_product_order(
            'EUR', 25, NULL, NULL, '{}'::JSONB,
            jsonb_build_array(jsonb_build_object(
                'product_id', v_product_id::TEXT,
                'product_name', 'Invalid quantity',
                'quantity', 1.5,
                'unit_price', 25,
                'final_price', 25,
                'subtotal', 25
            ))
        );
    EXCEPTION WHEN raise_exception THEN
        v_conflict := SQLERRM = 'Invalid order quantity';
    END;
    IF NOT v_conflict THEN
        RAISE EXCEPTION 'fractional quantity was accepted';
    END IF;

    v_conflict := FALSE;
    BEGIN
        PERFORM public.create_product_order(
            'EUR', 25, NULL, NULL, '{}'::JSONB,
            jsonb_build_array(jsonb_build_object(
                'product_id', v_other_product_id::TEXT,
                'product_name', 'Wrong SKU product',
                'sku_id', v_sku_id::TEXT,
                'quantity', 1,
                'unit_price', 25,
                'final_price', 25,
                'subtotal', 25
            ))
        );
    EXCEPTION WHEN raise_exception THEN
        v_conflict := SQLERRM = 'SKU unavailable for product';
    END;
    IF NOT v_conflict THEN
        RAISE EXCEPTION 'SKU/product mismatch was accepted';
    END IF;
    SELECT stock INTO v_stock FROM public.product_skus WHERE id = v_sku_id;
    IF v_stock <> 5 THEN
        RAISE EXCEPTION 'failed SKU reservation changed stock';
    END IF;

    IF has_table_privilege('anon', 'public.order_headers', 'INSERT')
       OR has_table_privilege('authenticated', 'public.order_items', 'INSERT') THEN
        RAISE EXCEPTION 'direct client order inserts remain granted';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        IF NOT EXISTS (
            SELECT 1 FROM cron.job
            WHERE jobname = 'expire-product-order-reservations'
        ) THEN
            RAISE EXCEPTION 'pg_cron is installed but reservation expiry is unscheduled';
        END IF;
    END IF;
END
$verification$;

ROLLBACK;
