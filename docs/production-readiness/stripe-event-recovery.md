# Stripe webhook recovery

Migration: `20260921000000_stripe_event_delivery_leases.sql`.

New deliveries have a five-minute lease and a random attempt token. A completed
delivery returns 200 without dispatch. An active delivery returns 500 so Stripe
can retry; an expired delivery can be claimed again. Handler success is recorded
before returning 200. Completion and release require the owning token. Failed
release is recoverable after lease expiry; unresolved rows are not purged.

This provides at-least-once processing, not exactly-once side effects. A crash
after a business write but before completion can repeat the handler. A worker
that runs longer than five minutes may overlap its replacement: the token fences
the event record, not every downstream write. Existing atomic order settlement
must remain idempotent; notifications may repeat. This change does not introduce
a queue or solve ordering between different Stripe events.

Existing rows retain `completed_at = processed_at`. The old schema cannot tell
whether an event actually completed. Historical suspected losses require checking
the Stripe event against the order/payment and a targeted reconciliation decision;
do not clear the event table or replay all historical events.

## Release (requires separate production authorization)

1. Route webhook requests to a temporary non-2xx response and drain/stop old
   webhook workers. Do not run old and new handlers concurrently: the old code
   treats an active lease as completed and deletes claims without a token.
2. Apply the additive migration, then deploy the new backend. No old rows are
   removed, and the legacy RPC remains available for code compatibility only.
3. Verify the three new RPCs exist and only service_role can execute them. Verify
   a sandbox payment, duplicate delivery and worker interruption/retry before
   reopening the webhook route. Check actual order settlement, not just HTTP 200.
4. Monitor 5xx responses and unresolved leases. Recovery depends on another Stripe
   delivery; it is not an autonomous background retry. After Stripe's retry window,
   investigate and resend the specific event through Stripe.

For rollback, first close/drain the webhook route again. Keep the additive schema
and event records. Do not resume the old handler while unresolved deliveries exist;
resolve them with the new handler or reconcile individually. A blind application
rollback would restore the lost-event bug. Prefer a forward fix.

Read-only unresolved-event query (service role/operator):

```sql
SELECT event_id, processed_at, lease_expires_at
FROM public.processed_stripe_events
WHERE completed_at IS NULL
ORDER BY lease_expires_at;
```

Local/CI SQL check after migrations:
`psql -v ON_ERROR_STOP=1 -f supabase/tests/stripe_event_delivery_leases.sql`.
It runs fixtures inside a transaction and rolls them back. Backend checks:
`pnpm --filter @alanya-holidays/backend test --runInBand --testPathPatterns=webhooks`
and `pnpm --filter @alanya-holidays/backend test:e2e --runInBand`.

Provider retry and duplicate-delivery semantics:
[Stripe webhook documentation](https://docs.stripe.com/webhooks#automatic-retries).

## Local verification — 2026-09-21

Branch `codex/payment-deployment-reliability`, uncommitted changes over
`5431dcd8cd2e7ffd306de478f274eb89fe0ffad0`; Node 22.21.1, pnpm 11.16.0.
All checks below exited 0:

- `pnpm --filter @alanya-holidays/backend test --runInBand`: 161 suites, 2162 tests.
- `pnpm --filter @alanya-holidays/backend test:e2e --runInBand`: 5 suites, 47 tests.
- After type-only corrections, focused webhook tests: 11 suites, 91 tests.
- `pnpm type-check`, `pnpm build` and
  `pnpm --filter @alanya-holidays/backend exec eslint '{src,apps,libs,test}/**/*.ts'`.
- `bash scripts/test-production-deployment-contract.sh`: 46 assertions.
- `git diff --check` and `git diff --cached --check`.
- On disposable PostgreSQL 14 at localhost:55439, original event migration,
  a pre-migration event fixture, new migration, and
  `psql -X -h 127.0.0.1 -p 55439 -d postgres -v ON_ERROR_STOP=1 -f supabase/tests/stripe_event_delivery_leases.sql`.
  Old fixture stayed completed. Sixteen concurrent psql connections produced
  one successful claim and fifteen busy results. Lease expiry was simulated
  by moving its timestamp into the past.

Production migration, live Stripe, and the entire historical migration chain
were not executed. No independent agent review was used, per user instruction.
