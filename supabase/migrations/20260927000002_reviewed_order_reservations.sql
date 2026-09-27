CREATE OR REPLACE FUNCTION public.create_product_order(
    p_currency TEXT,
    p_subtotal NUMERIC,
    p_customer_notes TEXT,
    p_customer_id UUID,
    p_recipient JSONB,
    p_items JSONB,
    p_request_id UUID DEFAULT NULL,
    p_request_payload JSONB DEFAULT NULL,
    p_guest_access_token_hash TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_order_id BIGINT;
    v_existing public.order_headers%ROWTYPE;
    v_item JSONB;
    v_quantity INTEGER;
    v_product_id BIGINT;
    v_sku_id BIGINT;
    v_fingerprint TEXT;
    v_expires_at TIMESTAMPTZ := now() + INTERVAL '24 hours';
BEGIN
    IF (p_request_id IS NULL) <> (p_request_payload IS NULL) THEN
        RAISE EXCEPTION 'Invalid order idempotency metadata';
    END IF;
    IF p_customer_id IS NULL
       AND COALESCE(p_guest_access_token_hash, '') !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid order guest access token';
    END IF;
    IF p_customer_id IS NOT NULL AND p_guest_access_token_hash IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid order guest access token';
    END IF;
    IF COALESCE(p_recipient->>'name', '') = ''
       OR COALESCE(p_recipient->>'email', '') = ''
       OR COALESCE(p_recipient->>'phone', '') = ''
       OR COALESCE(p_recipient->>'address', '') = '' THEN
        RAISE EXCEPTION 'Invalid order recipient';
    END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
       OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Invalid order items';
    END IF;

    IF p_request_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));
        v_fingerprint := public.product_order_request_fingerprint(p_request_payload);
        SELECT * INTO v_existing FROM public.order_headers WHERE request_id = p_request_id;
        IF FOUND THEN
            IF v_existing.customer_id IS DISTINCT FROM p_customer_id
               OR v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint
               OR v_existing.guest_access_token_hash IS DISTINCT FROM p_guest_access_token_hash THEN
                RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Idempotency key conflict';
            END IF;
            RETURN jsonb_build_object('data', v_existing.id, 'status', v_existing.status,
                                      'expires_at', v_existing.reservation_expires_at);
        END IF;
    END IF;

    INSERT INTO public.order_headers (
        currency, payment_provider, status, subtotal_items, customer_notes,
        customer_id, recipient, request_id, request_fingerprint,
        reservation_state, reservation_expires_at, guest_access_token_hash
    ) VALUES (
        upper(p_currency), 'unselected', 'pending_payment', p_subtotal,
        p_customer_notes, p_customer_id, p_recipient, p_request_id,
        v_fingerprint, 'reserved', v_expires_at, p_guest_access_token_hash
    ) RETURNING id INTO v_order_id;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        IF COALESCE(v_item->>'quantity', '') !~ '^[1-9][0-9]*$'
           OR COALESCE(v_item->>'product_id', '') !~ '^[1-9][0-9]*$' THEN
            RAISE EXCEPTION 'Invalid order item';
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
            WHERE sku.id = v_sku_id AND sku.product_id = v_product_id
              AND product.id = v_product_id AND product.status = 'active' AND product.moderation_status = 'approved'
              AND sku.stock >= v_quantity;
            IF NOT FOUND THEN RAISE EXCEPTION 'SKU unavailable for product'; END IF;
        ELSE
            v_sku_id := NULL;
            UPDATE public.product_items
            SET stock = stock - v_quantity
            WHERE id = v_product_id AND status = 'active' AND moderation_status = 'approved' AND stock >= v_quantity;
            IF NOT FOUND THEN RAISE EXCEPTION 'Product unavailable or insufficient stock'; END IF;
        END IF;

        INSERT INTO public.order_items (
            order_id, product_id, product_name, sku_id, sku_label, quantity,
            unit_price, final_price, subtotal
        ) VALUES (
            v_order_id, v_product_id::TEXT, v_item->>'product_name',
            CASE WHEN v_sku_id IS NULL THEN NULL ELSE v_sku_id::TEXT END,
            v_item->>'sku_label', v_quantity,
            (v_item->>'unit_price')::NUMERIC, (v_item->>'final_price')::NUMERIC,
            (v_item->>'subtotal')::NUMERIC
        );
    END LOOP;
    RETURN jsonb_build_object('data', v_order_id, 'status', 'pending_payment',
                              'expires_at', v_expires_at);
END;
$$;
