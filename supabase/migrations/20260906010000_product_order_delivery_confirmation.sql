-- Delivery quoting, guest order access, and payment selection for reserved orders.
-- Legacy rows stay untouched because their inventory history is not reconstructable.

ALTER TABLE public.order_headers
    ADD COLUMN guest_access_token_hash TEXT,
    ADD COLUMN delivery_fee NUMERIC(10, 2),
    ADD COLUMN delivery_eta TEXT,
    ADD COLUMN delivery_quote_confirmed_at TIMESTAMPTZ,
    ADD COLUMN total_amount NUMERIC(10, 2),
    ADD COLUMN stripe_checkout_session_id TEXT,
    ADD COLUMN stripe_session_expires_at TIMESTAMPTZ,
    ADD COLUMN payment_intent_id TEXT,
    ADD COLUMN payment_received_at TIMESTAMPTZ,
    ADD COLUMN payment_reconciliation_status TEXT NOT NULL DEFAULT 'none';

ALTER TABLE public.order_headers
    ADD CONSTRAINT order_headers_guest_access_hash_check CHECK (
        guest_access_token_hash IS NULL
        OR guest_access_token_hash ~ '^[0-9a-f]{64}$'
    ),
    ADD CONSTRAINT order_headers_delivery_quote_check CHECK (
        (delivery_fee IS NULL AND delivery_eta IS NULL
         AND delivery_quote_confirmed_at IS NULL AND total_amount IS NULL)
        OR
        (delivery_fee >= 0 AND delivery_eta <> ''
         AND delivery_quote_confirmed_at IS NOT NULL
         AND total_amount = subtotal_items + delivery_fee)
    ),
    ADD CONSTRAINT order_headers_payment_reconciliation_check CHECK (
        payment_reconciliation_status IN ('none', 'late_payment', 'mismatch')
    );

CREATE UNIQUE INDEX order_headers_guest_access_token_hash_key
    ON public.order_headers (guest_access_token_hash)
    WHERE guest_access_token_hash IS NOT NULL;
CREATE UNIQUE INDEX order_headers_stripe_checkout_session_id_key
    ON public.order_headers (stripe_checkout_session_id)
    WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX order_headers_payment_intent_id_key
    ON public.order_headers (payment_intent_id)
    WHERE payment_intent_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.get_product_order_replay(UUID, UUID, JSONB);
CREATE FUNCTION public.get_product_order_replay(
    p_request_id UUID,
    p_customer_id UUID,
    p_request_payload JSONB,
    p_guest_access_token_hash TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_order public.order_headers%ROWTYPE;
    v_fingerprint TEXT;
BEGIN
    IF p_request_id IS NULL OR p_request_payload IS NULL THEN
        RAISE EXCEPTION 'Invalid order idempotency metadata';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));
    v_fingerprint := public.product_order_request_fingerprint(p_request_payload);
    SELECT * INTO v_order FROM public.order_headers WHERE request_id = p_request_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF v_order.customer_id IS DISTINCT FROM p_customer_id
       OR v_order.request_fingerprint IS DISTINCT FROM v_fingerprint
       OR v_order.guest_access_token_hash IS DISTINCT FROM p_guest_access_token_hash THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Idempotency key conflict';
    END IF;
    RETURN jsonb_build_object('data', v_order.id, 'status', v_order.status,
                              'expires_at', v_order.reservation_expires_at);
END;
$$;
REVOKE ALL ON FUNCTION public.get_product_order_replay(UUID, UUID, JSONB, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_order_replay(UUID, UUID, JSONB, TEXT)
    TO service_role;

DROP FUNCTION IF EXISTS public.create_product_order(
    TEXT, NUMERIC, TEXT, UUID, JSONB, JSONB, UUID, JSONB
);
CREATE FUNCTION public.create_product_order(
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
              AND product.id = v_product_id AND product.status = 'active'
              AND sku.stock >= v_quantity;
            IF NOT FOUND THEN RAISE EXCEPTION 'SKU unavailable for product'; END IF;
        ELSE
            v_sku_id := NULL;
            UPDATE public.product_items
            SET stock = stock - v_quantity
            WHERE id = v_product_id AND status = 'active' AND stock >= v_quantity;
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
REVOKE ALL ON FUNCTION public.create_product_order(
    TEXT, NUMERIC, TEXT, UUID, JSONB, JSONB, UUID, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_product_order(
    TEXT, NUMERIC, TEXT, UUID, JSONB, JSONB, UUID, JSONB, TEXT
) TO service_role;

CREATE FUNCTION public.confirm_product_order_delivery_quote(
    p_order_id BIGINT, p_delivery_fee NUMERIC, p_delivery_eta TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_order public.order_headers%ROWTYPE; v_eta TEXT := btrim(p_delivery_eta);
BEGIN
    IF p_delivery_fee::TEXT = 'NaN' OR p_delivery_fee < 0
       OR p_delivery_fee <> round(p_delivery_fee, 2) OR v_eta = '' OR length(v_eta) > 200 THEN
        RAISE EXCEPTION 'Delivery quote is invalid';
    END IF;
    SELECT * INTO v_order FROM public.order_headers WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Delivery quote order not found'; END IF;
    IF v_order.delivery_quote_confirmed_at IS NOT NULL THEN
        IF v_order.delivery_fee = p_delivery_fee AND v_order.delivery_eta = v_eta THEN
            RETURN jsonb_build_object('delivery_fee', v_order.delivery_fee,
                'delivery_eta', v_order.delivery_eta, 'total_amount', v_order.total_amount,
                'delivery_quote_confirmed_at', v_order.delivery_quote_confirmed_at);
        END IF;
        RAISE EXCEPTION 'Delivery quote is immutable';
    END IF;
    IF v_order.status <> 'pending_payment' OR v_order.reservation_state <> 'reserved'
       OR v_order.reservation_expires_at <= now() THEN
        RAISE EXCEPTION 'Order reservation is not active';
    END IF;
    UPDATE public.order_headers SET delivery_fee = p_delivery_fee,
        delivery_eta = v_eta, total_amount = subtotal_items + p_delivery_fee,
        delivery_quote_confirmed_at = now(), updated_at = now()
    WHERE id = p_order_id RETURNING * INTO v_order;
    RETURN jsonb_build_object('delivery_fee', v_order.delivery_fee,
        'delivery_eta', v_order.delivery_eta, 'total_amount', v_order.total_amount,
        'delivery_quote_confirmed_at', v_order.delivery_quote_confirmed_at);
END;
$$;

CREATE FUNCTION public.select_product_order_manual_payment(p_order_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.order_headers%ROWTYPE;
BEGIN
    SELECT * INTO v_order FROM public.order_headers WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_order.delivery_quote_confirmed_at IS NULL THEN
        RAISE EXCEPTION 'Payment requires a confirmed delivery quote';
    END IF;
    IF v_order.status <> 'pending_payment' OR v_order.reservation_state <> 'reserved'
       OR v_order.reservation_expires_at <= now() THEN
        RAISE EXCEPTION 'Order reservation is not active';
    END IF;
    IF v_order.payment_provider = 'manual' THEN
        RETURN jsonb_build_object('payment_provider', 'manual', 'status', v_order.status);
    END IF;
    IF v_order.payment_provider <> 'unselected' THEN
        RAISE EXCEPTION 'Payment method was already selected';
    END IF;
    UPDATE public.order_headers SET payment_provider = 'manual', updated_at = now()
    WHERE id = p_order_id;
    RETURN jsonb_build_object('payment_provider', 'manual', 'status', v_order.status);
END;
$$;

CREATE FUNCTION public.begin_product_order_online_payment(p_order_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.order_headers%ROWTYPE; v_checkout_expires_at TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_order FROM public.order_headers WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_order.delivery_quote_confirmed_at IS NULL THEN
        RAISE EXCEPTION 'Payment requires a confirmed delivery quote';
    END IF;
    IF v_order.total_amount <= 0 THEN
        RAISE EXCEPTION 'Payment total must be greater than zero for online payment';
    END IF;
    IF v_order.status <> 'pending_payment' OR v_order.reservation_state <> 'reserved'
       OR v_order.reservation_expires_at <= now() THEN
        RAISE EXCEPTION 'Order reservation has too little time for online payment';
    END IF;
    IF v_order.payment_provider NOT IN ('unselected', 'stripe') THEN
        RAISE EXCEPTION 'Payment method was already selected';
    END IF;
    IF v_order.payment_provider = 'stripe' THEN
        IF v_order.stripe_session_expires_at IS NULL
           OR v_order.stripe_session_expires_at <= now() THEN
            RAISE EXCEPTION 'Online payment session is no longer payable';
        END IF;
        v_checkout_expires_at := v_order.stripe_session_expires_at;
    ELSE
        v_checkout_expires_at := date_trunc('second', LEAST(
            v_order.reservation_expires_at, now() + INTERVAL '24 hours'
        ));
        IF v_checkout_expires_at < now() + INTERVAL '35 minutes' THEN
            RAISE EXCEPTION 'Order reservation has too little time for online payment';
        END IF;
        UPDATE public.order_headers SET payment_provider = 'stripe',
            stripe_session_expires_at = v_checkout_expires_at, updated_at = now()
        WHERE id = p_order_id RETURNING * INTO v_order;
    END IF;
    RETURN jsonb_build_object('id', v_order.id, 'currency', v_order.currency,
        'total_amount', v_order.total_amount, 'recipient', v_order.recipient,
        'delivery_quote_confirmed_at', v_order.delivery_quote_confirmed_at,
        'checkout_expires_at', v_checkout_expires_at);
END;
$$;

CREATE FUNCTION public.attach_product_order_checkout_session(
    p_order_id BIGINT, p_session_id TEXT, p_session_expires_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.order_headers%ROWTYPE;
BEGIN
    SELECT * INTO v_order FROM public.order_headers WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_order.status <> 'pending_payment'
       OR v_order.payment_provider <> 'stripe'
       OR v_order.stripe_session_expires_at IS DISTINCT FROM p_session_expires_at THEN
        RAISE EXCEPTION 'Payment session no longer matches this order';
    END IF;
    IF v_order.stripe_checkout_session_id IS NOT NULL
       AND v_order.stripe_checkout_session_id <> p_session_id THEN
        RAISE EXCEPTION 'Payment session no longer matches this order';
    END IF;
    UPDATE public.order_headers SET stripe_checkout_session_id = p_session_id,
        updated_at = now() WHERE id = p_order_id;
    RETURN jsonb_build_object('id', p_order_id, 'session_id', p_session_id);
END;
$$;

CREATE FUNCTION public.confirm_product_order_stripe_payment(
    p_order_id BIGINT, p_session_id TEXT, p_amount NUMERIC, p_currency TEXT,
    p_quote_confirmed_at TIMESTAMPTZ, p_payment_intent_id TEXT DEFAULT NULL
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.order_headers%ROWTYPE;
BEGIN
    SELECT * INTO v_order FROM public.order_headers WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_order.stripe_checkout_session_id IS DISTINCT FROM p_session_id THEN
        RAISE EXCEPTION 'Payment session does not match order';
    END IF;
    IF v_order.total_amount IS DISTINCT FROM p_amount
       OR upper(v_order.currency) <> upper(p_currency)
       OR v_order.delivery_quote_confirmed_at IS DISTINCT FROM p_quote_confirmed_at THEN
        UPDATE public.order_headers SET payment_reconciliation_status = 'mismatch',
            payment_intent_id = COALESCE(payment_intent_id, p_payment_intent_id),
            payment_received_at = COALESCE(payment_received_at, now()), updated_at = now()
        WHERE id = p_order_id;
        RETURN 'mismatch';
    END IF;
    IF v_order.status IN ('paid', 'shipped', 'completed') THEN RETURN 'paid'; END IF;
    IF v_order.status IN ('expired', 'cancelled') OR v_order.reservation_state = 'released'
       OR v_order.reservation_expires_at <= now() THEN
        IF v_order.reservation_state = 'reserved' THEN
            PERFORM public.release_product_order_reservation(p_order_id);
            UPDATE public.order_headers SET status = 'expired' WHERE id = p_order_id;
        END IF;
        UPDATE public.order_headers SET payment_reconciliation_status = 'late_payment',
            payment_intent_id = COALESCE(payment_intent_id, p_payment_intent_id),
            payment_received_at = COALESCE(payment_received_at, now()), updated_at = now()
        WHERE id = p_order_id;
        RETURN 'late_payment';
    END IF;
    IF v_order.status <> 'pending_payment' OR v_order.reservation_state <> 'reserved'
       OR v_order.payment_provider <> 'stripe' THEN
        RAISE EXCEPTION 'Payment cannot settle this order';
    END IF;
    UPDATE public.order_headers SET status = 'paid', reservation_expires_at = NULL,
        payment_intent_id = p_payment_intent_id, payment_received_at = now(),
        payment_reconciliation_status = 'none', updated_at = now()
    WHERE id = p_order_id;
    RETURN 'paid';
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_product_order_status(
    p_order_id BIGINT, p_expected_current_status TEXT, p_new_status TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.order_headers%ROWTYPE; v_updated_at TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_order FROM public.order_headers WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND OR v_order.status <> p_expected_current_status THEN RETURN NULL; END IF;
    IF NOT ((v_order.status = 'pending_payment' AND p_new_status IN ('paid','cancelled'))
        OR (v_order.status = 'paid' AND p_new_status IN ('shipped','cancelled'))
        OR (v_order.status = 'shipped' AND p_new_status = 'completed')) THEN
        RAISE EXCEPTION 'Invalid order status transition';
    END IF;
    IF v_order.reservation_state <> 'legacy_unknown'
       AND v_order.status = 'pending_payment' AND p_new_status = 'paid'
       AND (v_order.delivery_quote_confirmed_at IS NULL OR v_order.payment_provider <> 'manual') THEN
        RAISE EXCEPTION 'Payment requires a confirmed manual payment choice';
    END IF;
    IF p_new_status = 'cancelled' AND v_order.payment_provider = 'stripe'
       AND (v_order.status = 'paid' OR v_order.stripe_session_expires_at > now()) THEN
        RAISE EXCEPTION 'Cannot cancel an order with a payable or paid Stripe payment';
    END IF;
    IF p_new_status = 'cancelled' THEN PERFORM public.release_product_order_reservation(p_order_id); END IF;
    UPDATE public.order_headers SET status = p_new_status,
        reservation_expires_at = CASE WHEN p_new_status IN ('paid','shipped','completed','cancelled')
                                      THEN NULL ELSE reservation_expires_at END,
        reservation_state = CASE WHEN p_new_status IN ('shipped','completed')
                                      AND reservation_state = 'reserved' THEN 'committed'
                                 ELSE reservation_state END,
        updated_at = now()
    WHERE id = p_order_id RETURNING updated_at INTO v_updated_at;
    RETURN jsonb_build_object('id', p_order_id, 'status', p_new_status, 'updated_at', v_updated_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_pending_product_orders(
    p_now TIMESTAMPTZ DEFAULT now()
) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order RECORD; v_expired_count INTEGER := 0;
BEGIN
    FOR v_order IN SELECT id FROM public.order_headers
        WHERE status = 'pending_payment' AND reservation_state = 'reserved'
          AND reservation_expires_at <= p_now
          AND NOT (payment_provider = 'stripe' AND stripe_session_expires_at > p_now)
        FOR UPDATE SKIP LOCKED
    LOOP
        IF public.release_product_order_reservation(v_order.id) THEN
            UPDATE public.order_headers SET status = 'expired', updated_at = now()
            WHERE id = v_order.id;
            v_expired_count := v_expired_count + 1;
        END IF;
    END LOOP;
    RETURN v_expired_count;
END;
$$;

DO $$
DECLARE v_signature REGPROCEDURE;
BEGIN
    FOREACH v_signature IN ARRAY ARRAY[
        'public.confirm_product_order_delivery_quote(bigint,numeric,text)'::REGPROCEDURE,
        'public.select_product_order_manual_payment(bigint)'::REGPROCEDURE,
        'public.begin_product_order_online_payment(bigint)'::REGPROCEDURE,
        'public.attach_product_order_checkout_session(bigint,text,timestamp with time zone)'::REGPROCEDURE,
        'public.confirm_product_order_stripe_payment(bigint,text,numeric,text,timestamp with time zone,text)'::REGPROCEDURE
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_signature);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
    END LOOP;
END $$;
