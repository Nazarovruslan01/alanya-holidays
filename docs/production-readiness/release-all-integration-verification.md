# Release integration verification

Date: 2026-09-06
Contract: `RELEASE-ALL-20260906`
Branch: `codex/publish-profile-business-events`
Base: `762029c3d600a28185f7408fbafb3fbce6c9a5f3`
Assembled payload identity: base plus 40 files with aggregate SHA-256
`8bb92928d299e1821b6a61b1ad4898d50858bd63a3f45cc39718f141451f3e1f`
before this report was added.

## Provenance

All source worktrees were based on the same base commit. Their tracked patches and explicitly
untracked files were assembled byte-for-byte; the source and destination copies compared equal.
No integration conflict or product-code repair was required.

| Source branch | Frozen complete-state SHA-256 |
| --- | --- |
| `codex/sync-event-forms` | `d3538cf248eddba4c8968a7cb87d03a93cb6bf556cc300f382d8eb79855cd2a4` |
| `codex/verify-release-scenarios` | `9b07a0722a9c38cc7ca6043c38c04d80270fe788bc54d75edd543f4a748acf8c` |
| `codex/enable-imported-listing-claims` | `d91892b5fc32f1471b674f30d67fd591ba3e0142bcad68881510ecbaa224b71e` |
| `codex/business-menu-visibility` | `1278107f12d3eb6e6572bb6db3d90cd666e78c5c9d44ac69e8839829a7315bc2` |
| `codex/settings-header-spacing` | `b5c0fb9c65a43f227d272a056703874b96526563b9d54ecbd83cd1815ad32d05` |
| `codex/profile-avatar-upload` | `7dd21e529d6f30756c70384a3978388eaab3353c2eddbf695d281e0f4ce32b4b` |

The local environment used Node.js 22.18.0, pnpm 11.16.0, Vitest 4.1.10, Jest 30.4.1,
and PostgreSQL client/server 14.20. Dependencies were reused from the main checkout through
untracked `node_modules` symlinks; no dependency install or lockfile change occurred.

## Application gates

| Gate | Exact command | Result |
| --- | --- | --- |
| Frontend focused | `cd frontend && VITE_SUPABASE_URL=https://mock-supabase-url.supabase.co VITE_SUPABASE_ANON_KEY=mock-supabase-anon-key ./node_modules/.bin/vitest run src/api-services/events.service.test.ts src/pages/admin/__tests__/AdminContentLibraryTab.spec.tsx src/pages/events/components/HostEventModal.test.tsx src/pages/home/components/Navbar.test.tsx src/pages/business/register/page.test.tsx src/pages/register/RegistrationPage.test.tsx src/pages/settings/SettingsPage.test.tsx src/api-services/storage.service.test.ts src/pages/business/page.test.tsx src/components/feature/__tests__/ClaimListingModal.spec.tsx` | Exit 0; 10 files, 148 tests passed |
| Backend claim focused | `cd backend && ./node_modules/.bin/jest --runInBand src/directory/application/listing-claim.service.spec.ts src/directory/application/directory-listing.service.spec.ts` | Exit 0; 2 suites, 35 tests passed |
| Backend HTTP E2E | `cd backend && ./node_modules/.bin/jest --config test/jest-e2e.json --runInBand` | Exit 0; 5 suites, 46 tests passed |
| Frontend full | `cd frontend && VITE_SUPABASE_URL=https://mock-supabase-url.supabase.co VITE_SUPABASE_ANON_KEY=mock-supabase-anon-key ./node_modules/.bin/vitest run` | Exit 0; 149 files, 1,556 tests passed |
| Backend full | `cd backend && ./node_modules/.bin/jest --runInBand` | Exit 0; 155 suites, 2,126 tests passed |
| Frontend typecheck | `cd frontend && ./node_modules/.bin/tsc --noEmit` | Exit 0 |
| Backend typecheck | `cd backend && ./node_modules/.bin/tsc --noEmit` | Exit 0 |
| Frontend lint | `cd frontend && ./node_modules/.bin/eslint . --report-unused-disable-directives --max-warnings=0` | Exit 0; no fixes requested |
| Backend lint | `cd backend && ./node_modules/.bin/eslint '{src,apps,libs,test}/**/*.ts'` | Exit 0; no fixes requested |
| Backend formatting | `cd backend && ./node_modules/.bin/prettier --check src/directory/application/directory-listing.service.ts src/directory/application/directory-listing.service.spec.ts test/critical-flows.e2e-spec.ts test/payment-flow.e2e-spec.ts test/platform-milestones.e2e-spec.ts test/product-order-flow.e2e-spec.ts` | Exit 0 |
| Frontend build | `cd frontend && VITE_SUPABASE_URL=https://mock-supabase-url.supabase.co VITE_SUPABASE_ANON_KEY=mock-supabase-anon-key VITE_GOOGLE_MAPS_API_KEY=mock-google-maps-api-key ./node_modules/.bin/vite build` | Exit 0; 3,852 modules transformed; existing large-chunk warning |
| Backend build | `cd backend && ./node_modules/.bin/nest build` | Exit 0 |

The first sandboxed E2E invocation could not bind an ephemeral local port (`listen EPERM`). The
same unchanged command passed with local-listener permission; the failure was environmental.

## PostgreSQL gates

The authorized local PostgreSQL 14 cluster used socket `/private/tmp`, port `55439`. Product
fixtures ran against the existing `scenarios` database and rolled back. Claim fixtures used the
disposable `claim_verify` database.

| Gate | Exact command | Result |
| --- | --- | --- |
| Product reservations | `/opt/homebrew/bin/psql -h127.0.0.1 -p55439 -d scenarios -X -v ON_ERROR_STOP=1 -f supabase/tests/product_order_reservations.sql` | Exit 0; `BEGIN`, `DO`, `ROLLBACK` |
| Product delivery/payment | `/opt/homebrew/bin/psql -h127.0.0.1 -p55439 -d scenarios -X -v ON_ERROR_STOP=1 -f supabase/tests/product_order_delivery_confirmation.sql` | Exit 0; `BEGIN`, `DO`, `ROLLBACK` |
| Imported-claim access | `/opt/homebrew/bin/psql -h /private/tmp -p 55439 -d claim_verify -X -v ON_ERROR_STOP=1 -f supabase/tests/listing_claim_import_access.sql` | Exit 0; imported/admin eligibility, preservation, grants, and rollback passed |
| Existing claim guards | `/opt/homebrew/bin/psql -h /private/tmp -p 55439 -d claim_verify -X -v ON_ERROR_STOP=1 -f supabase/tests/listing_claim_approval_eligibility.sql -f supabase/tests/listing_claim_insert_rls.sql` | Exit 0; expected anon/authenticated denials and service-role insert passed |
| Approval verification | `/opt/homebrew/bin/psql -h /private/tmp -p 55439 -d claim_verify -X -v ON_ERROR_STOP=1 -f supabase/tests/bootstrap_listing_claim_verification.sql -f db_scripts/verify_listing_claim_approval.sql` | Exit 0; rollback passed |

The two-session claim race used the committed disposable setup below:

```sh
/opt/homebrew/bin/psql -h /private/tmp -p 55439 -d claim_verify -X \
  -v ON_ERROR_STOP=1 -f supabase/tests/setup_listing_claim_concurrency.sql
```

Session one ran `BEGIN; SET LOCAL ROLE service_role;` and approved claim
`60000000-0000-4000-8000-000000000001` for listing
`50000000-0000-4000-8000-000000000001`, leaving the transaction open. Session two set role
`service_role` and attempted claim `60000000-0000-4000-8000-000000000002`; it waited until
session one committed, then returned `false, Listing is already claimed`. Replaying the first
approval returned `Claim already approved`. Final queries found exactly one approved claim,
`creation_source = 'import'`, a non-null owner, and a non-null `claimed_at`.

For full-history interaction coverage, database `release_all_20260906` was created fresh, then
initialized and migrated with:

```sh
/opt/homebrew/bin/psql -h /private/tmp -p 55439 -d release_all_20260906 \
  -X -v ON_ERROR_STOP=1 -f test/fixtures/init_test_db.sql
for migration_file in supabase/migrations/*.sql; do
  /opt/homebrew/bin/psql -h /private/tmp -p 55439 -d release_all_20260906 \
    -X -v ON_ERROR_STOP=1 -q -f "$migration_file" || exit 1
done
```

The fixture and all 161 migrations, including
`20260906020000_enable_imported_listing_claims.sql`, exited 0. The following CI verification
scripts also exited 0 on that database: `db_scripts/verify_rls_security.sql`,
`db_scripts/verify_listing_claim_approval.sql`,
`db_scripts/verify_listing_claim_token_security.sql`,
`db_scripts/verify_atomic_blog_comment_likes.sql`, and
`db_scripts/verify_business_account_registration.sql`. The local cluster has no CI `postgres`
role, so the two scripts that change profile roles used an admin fixture created inside the same
transaction; each script's final `ROLLBACK` removed it.

`supabase/tests/event_media_rls.sql` ran its rollback-wrapped RLS, cleanup, and idempotency
assertions locally, then PostgreSQL 14 `psql` exited 3 at line 1422 because that client does not
support the final phase's `\getenv` meta-command. The final dblink concurrency phase remains a
mandatory PostgreSQL 16 CI gate before merge. PostgreSQL 16 CI is also the authoritative full
migration compatibility result.

## Release condition

No production service, credential, database, migration history, or external data was changed.
The repository's CD workflow deploys the application after main-branch CI and E2E, but does not
apply database migrations. Imported listing claims therefore require a separate, manual production
application of `20260906020000_enable_imported_listing_claims.sql` using the rollout, verification,
cache invalidation, and forward-rollback procedure in
`docs/production-readiness/imported-listing-claim-rollout.md`. Merge must wait for the PostgreSQL 16
CI migration and event-media SQL gates.
