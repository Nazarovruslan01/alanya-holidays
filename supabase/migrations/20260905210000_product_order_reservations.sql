-- Add idempotent product-order creation and a bounded stock reservation lifecycle.
-- Existing orders are deliberately marked legacy_unknown: their historical stock
-- reservation state cannot be reconstructed safely, so lifecycle actions never
-- credit inventory for those rows.

ALTER TABLE public.order_headers
    ADD COLUMN request_id UUID,
    ADD COLUMN request_fingerprint TEXT,
    ADD COLUMN reservation_state TEXT NOT NULL DEFAULT 'legacy_unknown',
    ADD COLUMN reservation_expires_at TIMESTAMPTZ;

ALTER TABLE public.order_headers
    ADD CONSTRAINT order_headers_request_metadata_pair_check CHECK (
        (request_id IS NULL) = (request_fingerprint IS NULL)
    ),
    ADD CONSTRAINT order_headers_reservation_state_check CHECK (
        reservation_state IN ('legacy_unknown', 'reserved', 'released', 'committed')
    );

CREATE UNIQUE INDEX order_headers_request_id_key
    ON public.order_headers (request_id)
    WHERE request_id IS NOT NULL;

CREATE INDEX order_headers_pending_reservation_expiry_idx
    ON public.order_headers (reservation_expires_at)
    WHERE status = 'pending_payment' AND reservation_state = 'reserved';

-- The service-role RPC is the only supported write path. Direct client inserts
-- bypass stock reservation and idempotency, so remove the legacy public path.
DROP POLICY IF EXISTS order_headers_public_insert ON public.order_headers;
DROP POLICY IF EXISTS order_items_public_insert ON public.order_items;
REVOKE INSERT ON public.order_headers, public.order_items FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.product_order_request_fingerprint(
    p_request_payload JSONB
) RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
STRICT
SET search_path = public, extensions
AS $$
    SELECT encode(digest(convert_to(p_request_payload::TEXT, 'UTF8'), 'sha256'), 'hex')
$$;

REVOKE ALL ON FUNCTION public.product_order_request_fingerprint(JSONB)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_product_order_replay(
    p_request_id UUID,
    p_customer_id UUID,
    p_request_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_order_id BIGINT;
    v_customer_id UUID;
    v_fingerprint TEXT;
    v_existing_fingerprint TEXT;
    v_status TEXT;
    v_expires_at TIMESTAMPTZ;
BEGIN
    IF p_request_id IS NULL OR p_request_payload IS NULL THEN
        RAISE EXCEPTION 'Invalid order idempotency metadata';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));
    v_fingerprint := public.product_order_request_fingerprint(p_request_payload);

    SELECT id, customer_id, request_fingerprint, status, reservation_expires_at
    INTO v_order_id, v_customer_id, v_existing_fingerprint, v_status, v_expires_at
    FROM public.order_headers
    WHERE request_id = p_request_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF v_customer_id IS DISTINCT FROM p_customer_id
       OR v_existing_fingerprint IS DISTINCT FROM v_fingerprint THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'Idempotency key conflict';
    END IF;

    RETURN jsonb_build_object(
        'data', v_order_id,
        'status', v_status,
        'expires_at', v_expires_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_product_order_replay(UUID, UUID, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_order_replay(UUID, UUID, JSONB)
    TO service_role;

DROP FUNCTION IF EXISTS public.create_product_order(
    TEXT, NUMERIC, TEXT, UUID, JSONB, JSONB
);

CREATE FUNCTION public.create_product_order(
    p_currency TEXT,
    p_subtotal NUMERIC,
    p_customer_notes TEXT,
    p_customer_id UUID,
    p_recipient JSONB,
    p_items JSONB,
    p_request_id UUID DEFAULT NULL,
    p_request_payload JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_order_id BIGINT;
    v_item JSONB;
    v_quantity INTEGER;
    v_product_id BIGINT;
    v_sku_id BIGINT;
    v_fingerprint TEXT;
    v_existing_customer_id UUID;
    v_existing_fingerprint TEXT;
    v_existing_status TEXT;
    v_existing_expires_at TIMESTAMPTZ;
    v_expires_at TIMESTAMPTZ := now() + INTERVAL '24 hours';
BEGIN
    IF (p_request_id IS NULL) <> (p_request_payload IS NULL) THEN
        RAISE EXCEPTION 'Invalid order idempotency metadata';
    END IF;
    IF p_items IS NULL
       OR jsonb_typeof(p_items) <> 'array'
       OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Invalid order items';
    END IF;

    IF p_request_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));
        v_fingerprint := public.product_order_request_fingerprint(p_request_payload);

        SELECT id, customer_id, request_fingerprint, status, reservation_expires_at
        INTO v_order_id, v_existing_customer_id, v_existing_fingerprint,
             v_existing_status, v_existing_expires_at
        FROM public.order_headers
        WHERE request_id = p_request_id;

        IF FOUND THEN
            IF v_existing_customer_id IS DISTINCT FROM p_customer_id
               OR v_existing_fingerprint IS DISTINCT FROM v_fingerprint THEN
                RAISE EXCEPTION USING
                    ERRCODE = '23505',
                    MESSAGE = 'Idempotency key conflict';
            END IF;

            RETURN jsonb_build_object(
                'data', v_order_id,
                'status', v_existing_status,
                'expires_at', v_existing_expires_at
            );
        END IF;
    END IF;

    INSERT INTO public.order_headers (
        currency,
        payment_provider,
        status,
        subtotal_items,
        customer_notes,
        customer_id,
        recipient,
        request_id,
        request_fingerprint,
        reservation_state,
        reservation_expires_at
    ) VALUES (
        p_currency,
        'manual',
        'pending_payment',
        p_subtotal,
        p_customer_notes,
        p_customer_id,
        p_recipient,
        p_request_id,
        v_fingerprint,
        'reserved',
        v_expires_at
    ) RETURNING id INTO v_order_id;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        IF COALESCE(v_item->>'quantity', '') !~ '^[1-9][0-9]*$' THEN
            RAISE EXCEPTION 'Invalid order quantity';
        END IF;
        IF COALESCE(v_item->>'product_id', '') !~ '^[1-9][0-9]*$' THEN
            RAISE EXCEPTION 'Invalid order product';
        END IF;

        v_quantity := (v_item->>'quantity')::INTEGER;
        v_product_id := (v_item->>'product_id')::BIGINT;

        IF NULLIF(v_item->>'sku_id', '') IS NOT NULL THEN
            IF (v_item->>'sku_id') !~ '^[1-9][0-9]*$' THEN
                RAISE EXCEPTION 'Invalid order SKU';
            END IF;
            v_sku_id := (v_item->>'sku_id')::BIGINT;

            UPDATE public.product_skus AS sku
            SET stock = sku.stock - v_quantity
            FROM public.product_items AS product
            WHERE sku.id = v_sku_id
              AND sku.product_id = v_product_id
              AND product.id = v_product_id
              AND product.status = 'active'
              AND sku.stock >= v_quantity;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'SKU unavailable for product';
            END IF;
        ELSE
            v_sku_id := NULL;
            UPDATE public.product_items
            SET stock = stock - v_quantity
            WHERE id = v_product_id
              AND status = 'active'
              AND stock >= v_quantity;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Product unavailable or insufficient stock';
            END IF;
        END IF;

        INSERT INTO public.order_items (
            order_id,
            product_id,
            product_name,
            sku_id,
            sku_label,
            quantity,
            unit_price,
            final_price,
            subtotal
        ) VALUES (
            v_order_id,
            v_product_id::TEXT,
            v_item->>'product_name',
            CASE WHEN v_sku_id IS NULL THEN NULL ELSE v_sku_id::TEXT END,
            v_item->>'sku_label',
            v_quantity,
            (v_item->>'unit_price')::NUMERIC,
            (v_item->>'final_price')::NUMERIC,
            (v_item->>'subtotal')::NUMERIC
        );
    END LOOP;

    RETURN jsonb_build_object(
        'data', v_order_id,
        'status', 'pending_payment',
        'expires_at', v_expires_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_product_order(
    TEXT, NUMERIC, TEXT, UUID, JSONB, JSONB, UUID, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_product_order(
    TEXT, NUMERIC, TEXT, UUID, JSONB, JSONB, UUID, JSONB
) TO service_role;

CREATE OR REPLACE FUNCTION public.release_product_order_reservation(
    p_order_id BIGINT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_state TEXT;
    v_item RECORD;
BEGIN
    SELECT reservation_state
    INTO v_state
    FROM public.order_headers
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND OR v_state <> 'reserved' THEN
        RETURN FALSE;
    END IF;

    FOR v_item IN
        SELECT product_id, sku_id, quantity
        FROM public.order_items
        WHERE order_id = p_order_id
    LOOP
        IF NULLIF(v_item.sku_id, '') IS NOT NULL THEN
            UPDATE public.product_skus
            SET stock = stock + v_item.quantity
            WHERE id = v_item.sku_id::BIGINT
              AND product_id = v_item.product_id::BIGINT;
        ELSE
            UPDATE public.product_items
            SET stock = stock + v_item.quantity
            WHERE id = v_item.product_id::BIGINT;
        END IF;
    END LOOP;

    UPDATE public.order_headers
    SET reservation_state = 'released',
        reservation_expires_at = NULL,
        updated_at = now()
    WHERE id = p_order_id;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.release_product_order_reservation(BIGINT)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.transition_product_order_status(
    p_order_id BIGINT,
    p_expected_current_status TEXT,
    p_new_status TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_status TEXT;
    v_updated_at TIMESTAMPTZ;
BEGIN
    SELECT status
    INTO v_current_status
    FROM public.order_headers
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND OR v_current_status <> p_expected_current_status THEN
        RETURN NULL;
    END IF;

    IF NOT (
        (v_current_status = 'pending_payment' AND p_new_status IN ('paid', 'cancelled'))
        OR (v_current_status = 'paid' AND p_new_status IN ('shipped', 'cancelled'))
        OR (v_current_status = 'shipped' AND p_new_status = 'completed')
    ) THEN
        RAISE EXCEPTION 'Invalid order status transition';
    END IF;

    IF p_new_status = 'cancelled' THEN
        PERFORM public.release_product_order_reservation(p_order_id);
    END IF;

    UPDATE public.order_headers
    SET status = p_new_status,
        reservation_expires_at = CASE
            WHEN p_new_status IN ('paid', 'shipped', 'completed', 'cancelled') THEN NULL
            ELSE reservation_expires_at
        END,
        reservation_state = CASE
            WHEN p_new_status IN ('shipped', 'completed')
                 AND reservation_state = 'reserved' THEN 'committed'
            ELSE reservation_state
        END,
        updated_at = now()
    WHERE id = p_order_id
    RETURNING updated_at INTO v_updated_at;

    RETURN jsonb_build_object(
        'id', p_order_id,
        'status', p_new_status,
        'updated_at', v_updated_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_product_order_status(BIGINT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_product_order_status(BIGINT, TEXT, TEXT)
    TO service_role;

CREATE OR REPLACE FUNCTION public.expire_pending_product_orders(
    p_now TIMESTAMPTZ DEFAULT now()
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
    v_expired_count INTEGER := 0;
BEGIN
    FOR v_order IN
        SELECT id
        FROM public.order_headers
        WHERE status = 'pending_payment'
          AND reservation_state = 'reserved'
          AND reservation_expires_at <= p_now
        FOR UPDATE SKIP LOCKED
    LOOP
        IF public.release_product_order_reservation(v_order.id) THEN
            UPDATE public.order_headers
            SET status = 'expired',
                updated_at = now()
            WHERE id = v_order.id;
            v_expired_count := v_expired_count + 1;
        END IF;
    END LOOP;

    RETURN v_expired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_pending_product_orders(TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_pending_product_orders(TIMESTAMPTZ)
    TO service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'expire-product-order-reservations',
            '*/5 * * * *',
            'SELECT public.expire_pending_product_orders()'
        );
    ELSE
        RAISE NOTICE 'pg_cron is unavailable; schedule public.expire_pending_product_orders() externally';
    END IF;
END
$$;
