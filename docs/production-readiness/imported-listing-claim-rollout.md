# Imported listing claim rollout and rollback

Migration `20260906020000_enable_imported_listing_claims.sql` makes a directory
listing claimable only while all four durable conditions are true:

- `status = 'approved'`
- `creation_source IN ('admin', 'import')`
- `owner_user_id IS NULL`
- `claimed_at IS NULL`

Submission still requires an authenticated backend request. Email verification
does not assign ownership. Only the existing admin review path can call the
service-role-only approval RPC, which locks the claim and listing before
rechecking the same conditions. Approval leaves `creation_source` unchanged.
For imported listings it also preserves `name`, `whatsapp`, `website`, `address`,
`short_description`, and every other catalog field; only ownership timestamps
and identifiers change. Admin-curated listings retain the legacy behavior that
applies claim-supplied contact and description fields during approval.

## Rollout

Before applying the migration, record counts with the exact new predicate and
check the table size so the generated-column rebuild can be scheduled within a
safe lock window:

```sql
SELECT
  creation_source,
  count(*) AS total,
  count(*) FILTER (
    WHERE status = 'approved'
      AND creation_source IN ('admin', 'import')
      AND owner_user_id IS NULL
      AND claimed_at IS NULL
  ) AS eligible
FROM public.directory_listings
GROUP BY creation_source
ORDER BY creation_source;

SELECT pg_size_pretty(pg_total_relation_size('public.directory_listings'));
```

A read-only production query on 2026-09-06 observed 94 imported listings, all
94 eligible, and one merchant listing, which was ineligible. Recalculate these
counts immediately before rollout; they are evidence, not a deployment target.

Apply the migration through the standard migration runner. Dropping and adding
the stored generated column takes a table lock and may rewrite the table on
PostgreSQL 14, so avoid peak directory write traffic. The migration does not
update listing ownership, listing provenance, or any existing claim row.

After migration, verify the generated expression, trigger, RPC execution grants,
and a sample imported listing:

```sql
SELECT pg_get_expr(adbin, adrelid)
FROM pg_attrdef
WHERE adrelid = 'public.directory_listings'::regclass
  AND adnum = (
    SELECT attnum
    FROM pg_attribute
    WHERE attrelid = 'public.directory_listings'::regclass
      AND attname = 'can_claim'
      AND NOT attisdropped
  );

SELECT pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.listing_claims'::regclass
  AND tgname = 'listing_claims_enforce_eligibility'
  AND NOT tgisinternal;

SELECT
  has_function_privilege('anon', 'public.approve_listing_claim(uuid,uuid)', 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', 'public.approve_listing_claim(uuid,uuid)', 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', 'public.approve_listing_claim(uuid,uuid)', 'EXECUTE') AS service_role_execute;
```

The expected grant result is `false, false, true`. Smoke-test one authenticated
submission for an eligible import, then approve it through the existing admin
queue. Confirm the listing receives the claim user as owner, `claimed_at` is
set, `creation_source` remains `import`, and all pre-approval catalog content is
unchanged even when the claim omits optional metadata.

Directory list, item, and slug responses may still carry the old `can_claim`
value in the Redis `directory:*` cache. Use the existing targeted directory
cache invalidation operation after the migration, or wait for the ten-minute
freshness window and revalidation before judging the public smoke test. An
already-rendered claim button may remain visible briefly after approval; the
server-side eligibility check still rejects a second submission.

## Rollback

Rollback must be another forward migration. Do not edit the applied migration
and do not run the full historical migrations, because the leading remediation
in `20260831002000_harden_listing_claim_approval.sql` changes pending claim data.
The rollback migration should contain only these prior definitions:

1. Rebuild `can_claim` with `creation_source = 'admin' AND claimed_at IS NULL`,
   matching `20260831000000_directory_listing_creation_source.sql`.
2. Restore only the prior `enforce_listing_claim_eligibility()` function and its
   trigger from that same migration.
3. Restore only the prior `approve_listing_claim(uuid, uuid)` function body and
   its revoke/grant statements from
   `20260831002000_harden_listing_claim_approval.sql`. Omit its initial `UPDATE`.

This rollback changes eligibility code only. It must not delete or reclassify
claims, clear owners, clear `claimed_at`, or change `creation_source`. Imported
claims still pending at rollback remain pending but cannot be approved under the
restored admin-only-source rule; administrators must resolve them individually.
Already approved imported claims retain their owner and provenance.

Before rollback, snapshot these values and compare them afterwards:

```sql
SELECT id, owner_user_id, claimed_at, creation_source
FROM public.directory_listings
WHERE creation_source = 'import'
ORDER BY id;

SELECT id, listing_id, user_id, status, rejection_reason
FROM public.listing_claims
WHERE listing_id IN (
  SELECT id FROM public.directory_listings WHERE creation_source = 'import'
)
ORDER BY id;
```

Invalidate `directory:*` again, or wait through the same cache window, before
checking the restored public behavior.

## Local verification

Run the rollback-wrapped tests first against a fresh disposable PostgreSQL 14
database named `claim_scenarios` or `claim_verify`:

```sh
psql -h /private/tmp -p 55439 -d claim_scenarios \
  -f supabase/tests/listing_claim_import_access.sql
psql -h /private/tmp -p 55439 -d claim_scenarios \
  -f supabase/tests/listing_claim_approval_eligibility.sql \
  -f supabase/tests/listing_claim_insert_rls.sql
psql -h /private/tmp -p 55439 -d claim_scenarios \
  -f supabase/tests/bootstrap_listing_claim_verification.sql \
  -f db_scripts/verify_listing_claim_approval.sql
```

The bootstrap opens a transaction and the existing verification script rolls it
back, so the three commands are repeatable on the same fresh database. Its
database-name guard prevents accidental use against an undeclared destination.

The separate two-session check uses a fresh disposable database named
`claim_concurrency`:

```sh
psql -h /private/tmp -p 55439 -d claim_concurrency \
  -f supabase/tests/setup_listing_claim_concurrency.sql
```

Open two `psql` sessions. Run this in session one and leave the transaction open:

```sql
BEGIN;
SET LOCAL ROLE service_role;
SELECT * FROM public.approve_listing_claim(
  '60000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001'
);
```

Run this in session two. It must wait for session one:

```sql
SET ROLE service_role;
SELECT * FROM public.approve_listing_claim(
  '60000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000001'
);
```

Commit session one. Session two must return `false` with `Listing is already
claimed`. A repeated approval of the first claim must return `Claim already
approved`. Finally assert exactly one approved claim and that listing
`50000000-0000-4000-8000-000000000001` retains the `import` creation source.

The frozen application gates are:

```sh
cd backend
./node_modules/.bin/jest --runInBand \
  src/directory/application/listing-claim.service.spec.ts \
  src/directory/application/directory-listing.service.spec.ts
./node_modules/.bin/jest --runInBand
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint '{src,apps,libs,test}/**/*.ts'
./node_modules/.bin/prettier --check \
  src/directory/application/directory-listing.service.ts \
  src/directory/application/directory-listing.service.spec.ts
./node_modules/.bin/nest build

cd ../frontend
VITE_SUPABASE_URL=https://mock-supabase-url.supabase.co \
VITE_SUPABASE_ANON_KEY=mock-supabase-anon-key \
  ./node_modules/.bin/vitest run \
  src/pages/business/page.test.tsx \
  src/components/feature/__tests__/ClaimListingModal.spec.tsx
VITE_SUPABASE_URL=https://mock-supabase-url.supabase.co \
VITE_SUPABASE_ANON_KEY=mock-supabase-anon-key \
  ./node_modules/.bin/vitest run
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint . \
  --report-unused-disable-directives --max-warnings=0
VITE_SUPABASE_URL=https://mock-supabase-url.supabase.co \
VITE_SUPABASE_ANON_KEY=mock-supabase-anon-key \
  ./node_modules/.bin/vite build
```
