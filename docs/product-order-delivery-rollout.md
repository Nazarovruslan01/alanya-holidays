# Product order delivery confirmation rollout

The `20260906010000_product_order_delivery_confirmation.sql` migration extends the existing product-order reservation flow. It keeps item pricing and stock reservation in the database transaction, adds one immutable delivery quote, records the selected payment provider, and verifies Stripe settlement against the stored Checkout Session, amount, currency, and quote timestamp.

## Rollout

1. Apply the catalog, stock-decrement, reservation, then delivery-confirmation migrations in timestamp order.
2. Configure the existing authenticated Stripe webhook endpoint and secret before enabling online product-order payment in the frontend. The redirect result does not mark an order paid.
3. Ensure `expire_pending_product_orders()` is scheduled in the deployment environment. The migration logs a notice when `pg_cron` is unavailable; an external scheduler is then required.
4. Verify a guest and an authenticated request through quote, manual selection, Stripe selection, webhook settlement, and delivery in a non-production environment before opening checkout.

Legacy rows retain `reservation_state = 'legacy_unknown'`. They remain visible and manually operable, but cancellation does not credit stock because their historical reservation state is unknown. Reconcile those rows separately rather than backfilling a reserved state.

A verified Stripe payment received after inventory was released stays out of the paid fulfillment path and records `payment_reconciliation_status = 'late_payment'`. A verified event with a mismatched amount, currency, or quote records `mismatch`. Both require operator review; the application does not re-reserve stock, retry fulfillment forever, refund, or charge again.

## Rollback

The migration is additive, but an older application cannot represent unquoted orders, provider selection, Stripe reconciliation, or delivery totals. Pause checkout and payment entry before rolling application code back. Preserve the A11 columns, constraints, functions, and stored data until all A11 orders have reached a safe terminal state and reconciliation is complete. Do not run a destructive down migration after A11 orders exist.
