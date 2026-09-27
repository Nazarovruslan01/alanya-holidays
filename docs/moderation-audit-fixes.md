# Moderation audit fixes — MOD-20260927

## Authority and scope

The user authorized correcting all 14 audit findings, mandatory administrator
review of new public user content and future public edits, and registration/role
verification. They explicitly chose to preserve existing published content.
They later narrowed implementation to currently exposed frontend areas; dormant
property booking/calendar functionality is not being developed or enabled.

The user explicitly approved reuse of the existing Astra agents/current effort
settings as an exception to the workflow's exact model/effort routing. Astra
`/root/public_frontend_audit` was the sole writer; Astra `/root/backend_audit`
performed independent read-only review, and Astra `/root/admin_sync_audit`
performed independent verification. Their existing effort settings were accepted
by the user; this report does not claim the workflow's exact effort routing.
No production database, deployment, commit, push, or PR action is authorized here.

The task branch is `codex/moderation-audit-fixes`, in
`/Users/ruslannazarov/.codex/worktrees/moderation-audit-fixes/alanya-holidays`, based on
`112405390ab853e6a750e7823e9d5ff591888ba9`. Nine pre-existing frontend edits were
copied unchanged into it; their baseline patch SHA-256 is
`7cf77da9cafa03a97ca9ddcfe53dc69ef3b1ce621f36408532eef393954278fc`.
Those edits concern display-label localization, public translations, the explore
business card, and travel-guide page/modal/tests. They are not audit-fix evidence.

## Publication contract

| Content | Public reads | New records / edits | Review surface |
| --- | --- | --- | --- |
| Directory listings | Approved native state and moderation | Pending; related locations invalidate revision | Existing listings queue and public-content queue |
| Shop / legacy products | Active and moderation approved; children require visible parent | Content/variant changes pending; stock remains operational | Public-content queue / library |
| Events | Published and moderation approved | New/edited public values pending; approved-business capability retained | Public-content queue / library |
| Blog / guides | Published and moderation approved, including related RPC and comments | Content/tags pending | Public-content queue / library |
| Forum discussions / replies | Approved, not removed, visible parent | New/edited content pending | Public-content queue |
| Business reviews | Approved native and moderation states | Pending; rejected records leave pending queues | Public-content queue / reviews queue |
| Public profiles | Canonical last-approved values in all author joins | Separate owner-readable proposed revision; signup uses neutral values | Public-content queue; owner settings show proposal/status |
| Public itineraries | Public flag plus approval | New public sharing / edits pending | Public-content queue |
| Services | Approved native and moderation states | Existing service edit mechanism preserves published service until review | Revision queue; minimal audited security repairs retained |

Private messages, cart/orders, account authentication/security changes, private
itineraries, stock operations, and business/premium capabilities are not public
content publication decisions. Profile contact fields are distinct from the
authentication identity: public contact proposals are staged, while `auth.users`
email/password/session mechanics are unchanged.

Each reviewed content revision is checked under a row lock. Related variant/tag/
location edits invalidate the parent revision. Service proposals carry the base
service revision. A stale approval cannot silently apply to a newer submission.
Administrator publishing uses the returned content revision; missing metadata or
a conflict requires a fresh preview rather than reporting publication success.

The migration grandfathers only rows satisfying their prior publication
predicate. It does not claim that legacy content was manually reviewed. Existing
draft/rejected/removed records are not granted a publication entitlement.

## Audit fixes

1. Strip owner-controlled directory premium/tier and moderation fields.
2. Use the concrete service DTO and force ordinary submissions pending.
3. Gate public service/property sibling reads by approval; guard iCal secrets.
4. Preserve the guest checkout access token through the frontend wrapper.
5. Reject incompatible cart currency before committing a cart update.
6. Server-side pagination/filtering and totals for administrative queues.
7. Forward selected product quantity into the cart.
8. Resolve saved favorite IDs beyond the initial directory page.
9. Preserve real gallery images and remove fabricated business gallery photos.
10. Permit the Google Maps JavaScript API in both effective nginx CSP policies.
11. Resolve blog slug collisions with a single exact-or-prefix predicate.
12. Page the administrative content library, including drafts after many live rows.
13. Send explicit nulls when clearing article category/cover fields.
14. Fetch global pending badges with exact count-only queries, independent of
    locally selected queue filters.

## Roles and registration

Supported stored identities remain `guest`, legacy `user`, `host`, `artisan`,
and `admin`; no moderator role is introduced. Profile role is server/DB authority;
auth metadata never grants an administrative role. The role DTO validates this
allowlist; the admin UI includes all existing identities. An administrator cannot
demote their own account through the account-management API. Approved business
and premium subscription remain separate capabilities with their prior gates.
The token cache-miss path now checks the banned-account state as the hit path does.

Registration remains usable while public profile fields await review. Synthetic
SQL fixtures verify that metadata claiming `role=admin` still creates a guest.
Mocked registration/auth tests do not prove live email delivery, redirect allowlists,
or production provider configuration.

## Reproducible local verification

Normal dependency setup: `pnpm install --frozen-lockfile` (this worktree used the
already available offline cache). Node 22.21.1 and pnpm 11.16.0 were used.

The SQL harness uses existing versioned `test/fixtures/init_test_db.sql`, every
versioned migration in filename order, synthetic legacy fixtures just before the
new migrations, and rollback-only assertions. Against a newly created empty
local database named `moderation_*`, run:

```sh
PGDATABASE=moderation_contract PGPORT=55473 bash scripts/test-public-content-review.sh
```

The harness fixes the host to loopback and never selects a production database.
The repository's existing fixture is intentionally incomplete: old property RPCs
are stubs and some historical constraints/columns differ from deployed schemas.
Passing it does not prove unknown production function bodies. The actual Alanya
Supabase project was initially absent from project discovery. Later direct access
enabled a read-only catalog check: no production data or schema was modified.
The catalog exposed four fixture differences (products.status, profile roles,
service-edit approved state, and service draft checks). The user explicitly
approved all four local corrections; the regression harness reproduces those
legacy constraints before applying the draft migration. Unknown property RPC
bodies remain outside the active feature scope.

Intermediate evidence: backend 2,166 unit tests pass; the original 48 HTTP tests
passed, and the new review HTTP tests cover role/DTO/revision/audit boundaries.
The substantive SQL harness passes signup staging, role spoof rejection,
anonymous/owner/other-member visibility, stale approval, rejection, profile
approval, comment counters/notifications, and legacy publication retention.
Final independent command results are recorded below.

## Rollout and rollback

Deployment is a separate approval/action. Stop public publishing traffic during
the coordinated migration/backend/frontend transition. Apply additive migrations,
then the compatible backend/frontend, and smoke-test each active content type,
owner preview, admin queue, rejection, and public visibility before reopening.
Retain all queue/revision data. Never auto-approve pending content as a rollback.

A rollback to an old backend alone is unsafe: older service-role readers do not
filter moderation fields and could expose pending rows despite RLS. Keep the
moderation boundary enforced, stop affected public/write traffic if necessary,
and deploy a compatible build or forward fix. Do not drop review columns/tables.

Automated approval review rejected a proposed anonymous `is_admin()` EXECUTE
grant. The implemented alternative preserves that revoke and separates anonymous
SELECT policies, replacing only the always-false anonymous admin predicate.
SQL asserts that anonymous EXECUTE remains denied. Automated review also blocked
removal of task-added property RPC restrictions after scope narrowing. Those small
security guards remain in the draft; property UI/booking/calendar development is
excluded, so the property module is not represented as untouched or fully tested.

## Final verification

Independent review round 1 found and repaired five concrete gaps: owner draft
publication could change billing fields; directory details did not check the
moderation state; refreshed listing rows could replace a preview's reviewed
revision; tag deletion queried nonexistent relationship columns; and tagged
article saves returned metadata from before the child changes. Regression checks
now cover each path, including background refresh while a preview is open.
Round 1 focused checks passed: backend directory/blog/admin/forum 706 tests in
40 suites; final additional invariants/repository checks 34 tests in 2 suites;
frontend listing revision/pagination/settings 30 tests in 3 files; HTTP review
boundary 6 tests; moderation browser scenarios 2 tests on Desktop Chrome at port
3173. Frontend `tsc --noEmit`, targeted backend ESLint, formatter and both diff
checks passed. The independent reviewer subsequently returned FINAL PASS with
all five findings resolved, including the round 2 correction below.

Review round 2 identified a race in the tagged-article refetch above: another
author could edit between child writes and the refetch. The final implementation
removes that refetch. Tagged create/update responses explicitly report pending
moderation and omit the revision used for automatic publication. Publication
requires a fresh preview in the existing public-content queue. Normal saves
without tag changes retain their exact returned revision. Interleaving regression
checks passed (41 backend tests and 5 frontend helper tests); backend typecheck,
shared build and targeted ESLint passed. No additional migration was introduced.

Frozen source identity uses `git diff --binary` SHA-256 for tracked changes.
The separate untracked digest sorts paths returned by
`git ls-files --others --exclude-standard -z`, then hashes each UTF-8 path, a NUL,
the file's exact bytes, and another NUL in order. The reviewed implementation had
tracked digest `06f8c3836dff985a5f85227627685254acb6d9c022c237f899a402e8d49aff38`
and untracked digest `ce4ba6fe2c1b34c4b327da700d3dfc181cfea8b49be1468fab150cb923ac0006`.
These identify the reviewed snapshot before this documentation-only ledger
update. The report is itself untracked, so its final digest is handed to the
coordinator separately rather than recorded self-referentially here. Product,
test and migration files remained frozen during this update; the primary
checkout's pre-existing patch remained unchanged.

For the reported deployed 403, the user signed into the in-app browser. Read-only
admin listing/library/event/catalog/shop views and article create/edit dialogs
loaded successfully. No save, delete, publication, account or role mutation was
attempted. The reported mutation 403 was neither reproduced nor claimed fixed.

Scope amendment: active non-SEO requirements from the
[customer document](https://docs.google.com/document/d/1CaAWaQcgyUxpW7GOeOsJOe7yATUWEoKZIbm35DqNJwo/edit?tab=t.0)
are included. SEO is explicitly excluded. Existing claim eligibility remains
admin-created or imported unowned listings; merchant listings are not claimable.
Rich editor paste/drop uses server uploads, the 100k limit remains, own guides
are included with paged owner content, and CTA shortcodes accept safe internal
destinations. The mobile Explore CTA passed actual viewport/click checks in
Desktop Chrome, Mobile Chrome and Safari; no homepage change was needed.

Automatic review initially blocked the atomic editorial migration and the four
catalog compatibility corrections. The user explicitly approved the named local
migration and all four corrections; subsequent writes succeeded. The editorial
RPC locks the submitted revision, publishes post/tags in one transaction, and
notifies only after success. No production migration was applied.

Latest focused evidence: registration 59 tests/5 files passed; editor 11 tests
passed; editorial/backend focused 185 tests/10 suites passed. Fresh disposable
SQL harnesses passed including catalog compatibility, stale editorial approval,
actual approved guide visibility, and concurrent service edit rejection. Final
full gates below supersede these intermediate snapshots.

### Independent final gate ledger

The verifier used Node 22.21.1 through an explicit PATH and pnpm 11.16.0 in the
task worktree. All declared gates passed. Frontend/backend/typecheck successful
summaries and logs were retained, although their process handles had expired
after context resumption; their exit codes were not re-read from those handles.
Backend lint was rerun independently and returned exit 0.

| Command | Final result |
| --- | --- |
| `pnpm --filter @alanya-holidays/frontend exec vitest run --reporter=verbose` | 1,625 tests / 157 files passed |
| `pnpm --filter @alanya-holidays/backend test --runInBand` | 2,168 tests / 161 suites passed |
| `pnpm --filter @alanya-holidays/backend test:e2e --runInBand` | 54 tests / 6 suites passed; exit 0 |
| `pnpm type-check` | 4/4 tasks passed |
| `pnpm build` | 3/3 tasks passed; exit 0 |
| `pnpm --filter @alanya-holidays/frontend lint` | Exit 0 |
| `pnpm --filter @alanya-holidays/backend exec eslint '{src,apps,libs,test}/**/*.ts'` | Exit 0 |
| `bash scripts/test-production-deployment-contract.sh` | 48 assertions passed |
| `node --test .github/workflows/e2e-smoke.test.mjs` | 2 tests passed |
| `PGDATABASE=moderation_verify_20260927_final PGPORT=55473 bash scripts/test-public-content-review.sh` | Passed on a fresh disposable local database |

Existing SQL checks each returned exit 0 using
`psql -h 127.0.0.1 -p 55473 -U postgres -d moderation_verify_20260927_final -X -v ON_ERROR_STOP=1 -f <file>`:
`db_scripts/verify_rls_security.sql`,
`db_scripts/verify_business_account_registration.sql`, and
`supabase/tests/publishing_fields.sql`.

Browser checks ran from `frontend`, with dummy Supabase/maps credentials,
`VITE_SUPABASE_URL=https://test.supabase.co`, mocked APIs and isolated port 3173:

```sh
pnpm exec playwright test --config=/tmp/alanya-moderation-playwright.config.ts --project='Desktop Chrome' --workers=1 --reporter=line production-readiness.spec.ts rbac.spec.ts roles-and-permissions.spec.ts public-content-review.spec.ts
pnpm exec playwright test --config=/tmp/alanya-moderation-playwright.config.ts --workers=1 --reporter=line mobile-explore-cta.spec.ts
```

The first command passed all 10 tests; the second passed all 3 browser projects
(Desktop Chrome, Mobile Chrome and Safari). Auxiliary mocked-browser
`ECONNREFUSED` messages do not establish live integration coverage.

Verifier logs are `/tmp/mod-verifier-{frontend,backend,http,types,build,frontend-lint,backend-lint,browser-desktop,browser-mobile}-final.log`
and `/tmp/mod-verifier-{sql,deployment,smoke}.log`. These are local run artifacts,
not required inputs to the versioned regression harness. After this doc-only
update, `git diff --check` and `git diff --cached --check` were run again.

Local implementation, independent review and declared verification are complete.
No commit, push, deployment or production write was performed. Staging rollout,
live provider/email configuration, and the customer's reported mutation 403
remain unverified; passing local and mocked checks is not a production-readiness
claim for those paths.

## Release integration amendment — MOD-20260927-PR

The user subsequently authorized commit, push, PR creation and merge when green.
The coordinator committed the reviewed snapshot as `cc7ecc3`; this integration
merges `origin/main` at `203c584` into the same task branch with `--no-commit
--no-ff`. The sole writer and independent review/verifier boundaries, and the
user-approved Astra routing exception, remain unchanged. Commit/push/PR/merge
actions belong to the coordinator. Production migration application was not
authorized or performed; the earlier verification ledger describes the prior
snapshot rather than this merged candidate.

Seven textual conflicts were resolved by preserving upstream draft aliases,
claim/review metadata, real galleries, content search and editor improvements
alongside reviewed-revision moderation and authoritative billing fields. Both
merchant account-isolation and resumed-draft regression groups remain. Upstream
rich-text limits are 100,000 visible characters and 500,000 raw HTML characters;
paste/drop still uses uploaded media. Legacy review endpoints still fail closed
without the inspected revision; the unified approval path invalidates directory
cache, and upstream cache invalidation on deletion is retained.

CD now checks the required moderation projections with read-only REST requests
using `limit=0`, including `profile_public_revisions`, service base revisions and
editorial submission revisions. It reads OpenAPI metadata to verify the parameter
contracts of `review_public_content` and `review_blog_submission`; it never calls
those mutation RPCs. The existing bounded retries and per-request timeout remain.
Missing columns/tables/RPC metadata stop CD before git reset or stack mutation,
leaving the running release in place. This can deliberately block deployment
after a green merge until a separately authorized schema rollout is complete.
This metadata preflight is a compatibility marker, not proof of trigger bodies
or a replacement for SQL regressions and rollout smoke tests.

Focused integration checks used Node 22.21.1 / pnpm 11.16.0 and
`pnpm install --offline --frozen-lockfile`. Backend focused blog/directory/reviews/
forum/rich-text checks passed 658 tests in 36 suites; frontend business/editor/
library/draft checks passed 120 tests in 12 files. Workspace typecheck passed all
4 tasks; both read-only linters passed. The deployment contract passed 58
assertions, including execution of the actual Node preflight with missing table,
column, RPC and stale-signature responses; workflow smoke passed 2 tests.

SQL verification uses PostgreSQL **16 server and client**, matching current CI.
The previously used PostgreSQL 14 server cannot execute the upstream six-argument
`regexp_replace`; its client also lacks `\getenv`. These were environment
failures, resolved without editing upstream migrations. The local PG16 container
is `alanya-mod-pr-pg16`, exposed only at `127.0.0.1:55474`. A transient
`postgres:16-alpine` client mounts the task worktree read-only at `/workspace`,
uses `--network container:alanya-mod-pr-pg16`, and sets `PGHOST=127.0.0.1`,
`PGPORT=5432`, `PGUSER=postgres`, `PGPASSWORD=postgrespassword` (synthetic CI value)
and a disposable `moderation_*` database. Run the fixture, all migrations, then
the complete ordered SQL verification commands in `.github/workflows/ci.yml`.
The separate moderation harness runs on another fresh disposable database.
The complete CI sequence passed on `moderation_integration_ci_final` (exit 0,
`/tmp/mod-integration-sql-ci16-final.log`); the moderation harness passed on
`moderation_integration_contract` (exit 0,
`/tmp/mod-integration-moderation-sql16.log`). Gallery/merchant integration checks
subsequently passed 88 tests in 2 files.

Historical SQL fixtures now explicitly establish reviewed publications before
testing claim/notification compatibility; review bypass is scoped to synthetic
setup and reset. Review metadata approval uses the real revision-checking RPC.
The published-event owner-edit regression now also asserts pending moderation
and revision advancement. No policies or production triggers were weakened to
satisfy prior publication assumptions. Integration logs use
`/tmp/mod-integration-*`; the final integration review/full verifier results are
recorded by the coordinator after the writer freezes this candidate.
