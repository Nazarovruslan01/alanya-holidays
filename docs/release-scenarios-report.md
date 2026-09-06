# Release scenario evidence

Date: 2026-09-06
Contract: `RELEASE-SCENARIOS-R1`
Code base: `762029c3d600a28185f7408fbafb3fbce6c9a5f3` plus the test-only diff on
`codex/verify-release-scenarios`

## Scenario matrix

| Boundary | Scenario | Evidence | Result |
| --- | --- | --- | --- |
| Guest order access | No capability and a neighboring capability cannot read the order; the matching capability can | Real Nest controller, optional auth guard, and product service over an in-memory repository | Pass |
| Buyer isolation | Another authenticated buyer receives the same 404 as an unknown order; the owner can read it | Real auth guard, controller, and product service over an in-memory repository | Pass |
| Request idempotency | Repeating the same request ID returns the first order without another stock decrement | Existing product service tests plus rollback-only PostgreSQL replay checks | Pass |
| Stock | Requests above available stock fail without creating an order | Existing product service tests plus rollback-only PostgreSQL checks | Pass |
| Stock concurrency | Two PostgreSQL sessions contend for one unit; one order commits and the other receives `Product unavailable or insufficient stock` | Manual temporary PostgreSQL 14 two-session run | Pass |
| Concurrent idempotency | Two PostgreSQL sessions submit the same request ID and payload; both return order 22, with one order row and one stock decrement | Manual temporary PostgreSQL 14 two-session run | Pass |
| Seller quote authorization | A non-owning user is rejected; the owning seller can confirm the quote | Real auth guard, controller, and product service over an in-memory repository | Pass |
| Payment provider choice | Guest access can start online payment only after the seller quote; the amount includes delivery | Real controller/service with fake billing gateway; rollback-only PostgreSQL payment-state checks | Pass |
| Signed payment webhook | A Stripe-signed product-order event reaches the real webhook service and handler with amount, currency, quote timestamp, and payment IDs | Real Stripe signature adapter; fake payment repository | Pass |
| Webhook idempotency | Repeating the signed event invokes settlement once | Real webhook service over an in-memory processed-event seam | Pass |
| Late and mismatched payments | Matching payment settles; mismatch is quarantined; a late payment does not re-reserve stock | Rollback-only PostgreSQL delivery/payment scenario | Pass |
| Browser access paths | Checkout display and role/access redirects on Desktop Chrome | Playwright with mocked checkout data | Pass, with limits below |

The existing E2E harness was also updated for current controller dependencies, role lookup,
booking pagination, authenticated media upload, user-scoped media folders, and webhook claim
semantics.

## Reproducible gates

Run from the repository root unless the command changes directory.

```sh
cd backend
./node_modules/.bin/jest --config test/jest-e2e.json --runInBand
```

Result: 5 suites and 46 tests passed. The added product-order suite contributes 3 tests.

```sh
cd backend
./node_modules/.bin/jest --runInBand
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint '{src,apps,libs,test}/**/*.ts'
./node_modules/.bin/prettier --check test/critical-flows.e2e-spec.ts test/payment-flow.e2e-spec.ts test/platform-milestones.e2e-spec.ts test/product-order-flow.e2e-spec.ts
./node_modules/.bin/nest build
```

Result: Jest passed 155 suites and 2,125 tests. TypeScript, ESLint without fixes, Prettier, and
the Nest build passed.

The SQL scenarios require a disposable PostgreSQL database with the catalog, stock, reservation,
and delivery/payment migrations applied. The verification blocks run inside transactions and end
with `ROLLBACK`.

```sh
/opt/homebrew/bin/psql -h127.0.0.1 -p55439 -d scenarios -X -v ON_ERROR_STOP=1 -f supabase/tests/product_order_reservations.sql
/opt/homebrew/bin/psql -h127.0.0.1 -p55439 -d scenarios -X -v ON_ERROR_STOP=1 -f supabase/tests/product_order_delivery_confirmation.sql
```

Result: both returned `BEGIN`, `DO`, `ROLLBACK`. The files contain 26 and 14 explicit failure
assertions respectively, in addition to their positive state checks.

The browser evidence was run from a checkout at the same relevant base:

```sh
CI=true ./node_modules/.bin/playwright test e2e/checkout.spec.ts e2e/roles-and-permissions.spec.ts --project='Desktop Chrome' --workers=1 --reporter=line
```

Result: 7 tests passed in 23.1 seconds.

## Integration limits

- The product-order HTTP suite uses real Nest routing, validation, authentication, authorization,
  product-order logic, Stripe signature verification, webhook dispatch, and webhook handling. Its
  catalog/order repository, billing checkout, processed-event store, and payment settlement store
  are in-memory fakes. The SQL scenarios provide the transactional persistence evidence.
- The two-session stock and same-key checks were manual runs against the disposable PostgreSQL 14
  database. They prove row locking and idempotent replay for those executions but are not a
  committed repeatable concurrency harness.
- The temporary database used local trust authentication and an `auth.uid()` stub returning NULL.
  It does not prove hosted Supabase identity propagation or RLS tenant isolation.
- No real Stripe API request ran. Local Stripe keys were unset or placeholders. Tests cover signed
  webhook parsing and gateway contracts without testing Stripe account configuration, network
  delivery, or live reconciliation operations.
- The browser run used mocked checkout data. Some unrelated proxied API calls logged
  `ECONNREFUSED`; the asserted checkout display and access redirects still passed. It does not prove
  a browser-to-real-backend purchase chain.
- No production service, credential, database, or external user data was changed.
