# Audit follow-up: SEARCH-1

Date: 2026-09-06. Branch: `codex/audit-search-ux-localization`.
Worktree: `/private/tmp/alanya-audit-search-ux-localization`.
Base: `74f63f68f346ad5abd8567b1a8f734a1077abbfe`.

## Contract and ownership

Six public result types: discussions, events, members, approved businesses,
active non-gift-card products, and published blog articles. Existing list APIs
gain bounded additive search/pagination parameters where needed. The URL keeps
the query; sections load, fail, retry and paginate independently. Late responses
cannot replace newer results. Counts describe loaded rows, not global totals.
Members are searched by public full name before pagination; products by name.
Events retain the existing link to the events page (there is no event-detail route).

SEO and the intentionally hidden planner/itineraries are excluded. No migrations,
dependencies, credentials, deployment, commits, pushes or external data mutations.
Public visibility and profile projections are preserved. Rollout is additive code;
rollback restores the prior application without data rollback.

Originally routed High-risk Sol/xhigh for interacting visibility/privacy/query
boundaries. Both implementation sessions stopped after their patch tools hung,
without applying changes. The user explicitly authorized the coordinator to write
directly while retaining independent review and verification: “ДАвай продолжим”.
Sole implementation writer: root (session model), under that routing exception.
Independent review: Terra/high; independent verification: Luna/medium. SEARCH-1
passed both. One repair loop added a unique discussion sort tie-breaker and a
200-character discussion query limit; three regression tests failed before the
fix and passed afterwards. Final backend focused: 8 suites / 134 tests; full:
159 suites / 2,151 tests. Types, lint, formatter, build and diff checks passed
again independently. Unchanged frontend evidence was retained.

## Environment and checks

Existing root/frontend/backend dependencies reused by symlink from the original
checkout, without installing project packages. WebKit was downloaded into the
Playwright cache because the installed version was absent. Test VITE values:

```text
VITE_SUPABASE_URL=https://mock-supabase-url.supabase.co
VITE_SUPABASE_ANON_KEY=mock-supabase-anon-key
VITE_GOOGLE_MAPS_API_KEY=test
```

All commands below run in the indicated package, using `./node_modules/.bin/`.

| Check | Command | Evidence |
| --- | --- | --- |
| FE baseline | `vitest run --maxWorkers=2 src/pages/SearchPage.spec.tsx` | 1 file / 7 tests, exit 0 |
| FE focused | `vitest run --maxWorkers=2 src/pages/SearchPage.spec.tsx src/api-services/forum.service.test.ts src/api-services/blog.service.test.ts src/i18n/locale-completeness.test.ts` | 4 files / 59 tests, exit 0 |
| BE focused | `jest --runInBand src/users/public-search.spec.ts src/users/users.controller.spec.ts src/users/users.service.spec.ts src/forum/forum.controller.spec.ts src/forum/forum.repository.spec.ts src/products/products.repository.spec.ts src/blog/blog.repository.spec.ts src/directory/directory.repository.spec.ts` | 8 suites / 131 tests, exit 0 |
| FE full | `vitest run --maxWorkers=2` | 151 files / 1579 tests, exit 0 |
| BE full | `jest --runInBand` | 159 suites / 2148 tests, exit 0 |
| FE types | `tsc --noEmit` | exit 0 after fixing unsupported test-only matcher options |
| BE types | `tsc --noEmit --incremental false` | exit 0 after adding required sort_order to a test fixture |
| FE lint | `eslint . --report-unused-disable-directives --max-warnings=0` | exit 0 |
| BE lint | `eslint '{src,apps,libs,test}/**/*.ts'` | exit 0, no autofix |
| BE build | `nest build` | exit 0 |
| FE build | `vite build` (Playwright webServer setup) | successful; existing large-chunk warning |
| Browser | `CI=true playwright test e2e/search.spec.ts --workers=1 --reporter=line` | Desktop and Mobile Chrome passed; initial Safari launch lacked WebKit |
| Safari follow-up | `CI=true playwright test e2e/search.spec.ts --project='Mobile Safari (iPhone 13-like)' --workers=1 --reporter=line` | 1 passed, exit 0 after WebKit installation |
| Diff checks | `git diff --check` and `git diff --cached --check` | exit 0 |

Backend formatter command: `prettier --check src/blog/blog.repository.ts src/directory/directory.repository.ts src/forum/dto/forum-events.dto.ts src/forum/forum.controller.spec.ts src/forum/forum.controller.ts src/forum/forum.repository.ts src/forum/types/forum.types.ts src/products/dto/get-shop-catalog-query.dto.ts src/products/products.repository.ts src/users/users.controller.spec.ts src/users/users.controller.ts src/users/users.repository.ts src/users/users.service.ts src/users/dto/public-members-query.dto.ts src/users/public-search.spec.ts` — exit 0. No frontend formatter script is configured; the existing Prettier binary formatted only the new/reworked search page and tests.

The two type errors were confined to test fixtures. Focused checks passed before
the full run; independent verification repeats the final state. Initial browser
launch hit the sandbox's local-port restriction and was rerun with permission.
The missing WebKit was an environment failure, not a browser assertion failure.

## Limits and code identity

Browser requests use controlled API fixtures; repository tests check real query
construction over fake Supabase builders. No hosted PostgREST/RLS or live data
performance test was run. Offset pagination has deterministic tie ordering but is
not a snapshot of a dataset being modified concurrently. `*` is treated as a space,
not a wildcard; SQL wildcard characters are escaped. Compound filters quote values
according to [PostgREST URL grammar](https://postgrest.org/en/v11/references/api/url_grammar.html).

Final tracked binary diff SHA-256: `e0ca424ec39350ded2dcef4ba7f15bded81a833d9abf23421cd436ce4fe5520e`.
Additional new files (evidence document excluded):

- `backend/src/users/dto/public-members-query.dto.ts`: `866c0cf397d8bebc9140c3f00bb5c37356827fc3a52f6449e7d26aa06aa97e4f`
- `backend/src/users/public-search.spec.ts` after review repairs: `dd82e7c03bdd37d081f42fe339385f339be8b3bda86d6e7e60a1cbc77c16a41d`
- `frontend/e2e/search.spec.ts`: `78a70aef55b75af940dd7bbe9709c86b8241f06c9e1975712fbc74d6ae860627`

Remaining authorized stages: visible-page UX/data credibility, RU/EN/TR localization,
mobile layout/accessibility. These are not covered by SEARCH-1 completion.

## UX-1 contract

Sequential Standard frontend slice, same branch/worktree and root sole-writer
exception. Scope: shared error defaults and confirmed visible callers, home live
statistics/events, evidence-backed business badges, compact catalogue filters and
320px overflow; translations and associated tests. No backend/API/schema changes,
new dependencies, planner, SEO, dormant service pages or publishing. Existing
component inputs and navigation destinations remain compatible. Display actual
data only; loading, failure, empty and retry states remain distinguishable.
Stop for unresolvable data-policy decisions or two failed completed attempts.
Focused gate: affected component tests; project gate: frontend `vitest run
--maxWorkers=2`, `tsc --noEmit`, `eslint . --report-unused-disable-directives
--max-warnings=0`, `vite build`, and controlled Playwright UX scenarios in the
existing three browser projects. Existing dependencies and VITE test environment
above; no frontend formatter script. Separate Terra/high review after writing.
Localization and mobile use these shared UI changes sequentially.

UX-1 result: Complete. Root sole writer under the user exception; Terra/high
review and one repair re-review resolved. The review found two remaining home
callers exposing API messages and a duplicate ownership badge; fixed with
regressions. Existing standalone legacy badge API is retained, but all four
active business consumers use only claimed_at-backed ownership labels.

- Baseline focused: 4 files / 28 tests, exit 0.
- Final full `vitest run --maxWorkers=2`: 152 files / 1,588 tests, exit 0.
- Final `tsc --noEmit` and `eslint . --report-unused-disable-directives --max-warnings=0`: exit 0.
- Controlled `CI=true playwright test e2e/localization.spec.ts e2e/search.spec.ts --workers=1 --reporter=line`: 12 passed; after review repairs affected localization spec repeated, 9 passed. Chrome desktop/mobile and Safari; EN/RU/TR, widths 320/360/390/430/768/1280. Vite build passed in browser setup.
- Initial full runs identified old badge/title/raw-error expectations; related fixtures were updated, narrow regressions passed, then final full gate passed. No tests skipped or assertions removed without replacement behavior coverage.
- Both diff checks passed. Tracked diff at UX freeze: `940c899067fee77e48261be507c54dba48cd143d671c497c99e6a111006598dd` (new files excluded).
- Live hosted backend/visual full-route coverage not claimed. CUA checked built login, personal and business registration in Russian at 320 px: no overflow; untranslated account-type switcher recorded for L10N-1.

## L10N-1 contract

Sequential Standard slice on the same branch/worktree, following completed UX-1.
Sole writer: localization_writer, selected standard_writer role (Luna/high).
Root is read-only in owned frontend paths; root owns this evidence document.
Outcome: EN/RU/TR for remaining visible UI literals and missing fallback keys in
active settings/auth/submission/business/product/community/admin paths, with dates
following the selected locale. Existing brands, user content and payload enum IDs
are preserved. No business/API/auth/payment logic, backend, dependencies, planner,
SEO, dormant services, commits or publication. Existing inputs/outputs stay frozen.
Acceptance: changed visible copy translates without changing form behavior or
navigation; locale parity and affected tests pass. Baseline SettingsPage: 27 tests;
full frontend above. Gate: focused affected component tests plus locale-completeness,
full vitest, tsc, eslint and vite build with the same environment; browser locale
checks after writer freeze; separate Terra/high review. No frontend formatter script.
Stop for material behavioral choices or two failed completed implementation attempts.

## Mobile follow-up evidence (read-only, before L10N-1 edits)

CUA against the built localhost preview at 320x900, Russian:

- Login, personal registration and business registration: page width 320, no
  overflowing input/button/label/form. Registration account-type switcher remained
  English; assigned to L10N-1.
- Navbar mobile menu opens/closes with Escape and returns focus to its trigger.
- Home document width reached 347 despite content fitting. DOM bounds identify
  WhatsAppFloatingButton's absolute animate-ping span expanding past viewport
  right edge (observed right=332); ordinary content did not overflow.
- Language picker remains expanded after Escape. Reserved for the subsequent
  mobile slice along with the WhatsApp button; L10N-1 excludes these files/tests.
- Footer email field has a translated placeholder but no explicit accessible label;
  add the existing auth.email label in the mobile accessibility slice.

L10N-1 writer stopped: settings/auth apply_patch stalled approximately 240 seconds,
was interrupted, and no changes were applied. Locale baseline 6/6 passed. The
existing explicit root-writer exception is retained for this task; root resumes
as sole writer after mobile fixes, with separate Terra/high review. No attempt
assessed against a completed implementation gate occurred in that stalled worker.

## MOBILE-1 contract

Standard sequential root-owned slice under the existing user exception, same
branch/worktree. Localization is paused without changes. Scope: WhatsApp pulse
overflow, language picker Escape/focus, footer and event search field labels,
event hero layout below fixed navigation and compact mobile event categories.
Existing routes, callbacks and data behavior stay unchanged; no API/dependencies,
SEO/planner or publishing. Existing translation keys suffice. Acceptance: no
horizontal overflow at320px including animation; header content below nav;
Escape closes picker and restores focus; category selection preserved. Focused
baseline WhatsApp+LanguageSwitcher 2files23tests passed. Gate: affected unit tests,
fullFE/types/lint/build and controlled Playwright mobile scenarios at320/390/768/1280
with locale variants. Separate Terra/high review after root stops. No FE formatter
script. Stop for material behavior choices or two completed failed attempts.

MOBILE-1 browser reproduction also found CommunityPulse's uppercase Russian
heading overflowing inside its own bounding box (323px text in272px box). Added
that precise typography path to scope: smaller narrow-screen type and word wrapping.
The pulse was a separate overflow source; DOM element bounds alone did not expose
the heading's text overflow, while scrollWidth did. Browser gate retained unchanged.

MOBILE-1 result: Complete. Terra/high review found no actionable findings.
Focused4files30tests and CommunityPulse5tests passed; full frontend152files1589tests
passed before the final typography-only repair, followed by final types/lint and
the unchanged browser gate3/3 across Chrome desktop/mobile and Safari. Build and
both diff checks passed. Final combined full gate will run after localization.
Root resumes L10N-1 as sole writer under the recorded exception, starting with
settings/auth and continuing the inventoried active UI copy. Mobile/UX business
behavior is frozen; reviewer reused after writing.

### L10N-1 progress — auth/settings batch, 2026-09-06

Broader L10N-1 remains in progress; this is not completion of the full contract.
Root sole writer under the recorded exception. EN/RU/TR settings fields, validation,
subscription/booking copy and dates now use the selected locale. Auth validation
presentation maps existing schema messages without modifying schema rules or API
contracts. Registration tests now initialize the real dictionary.

Terra/high reviewed the bounded batch and resolved both findings: reset-password
and avatar-upload errors no longer expose arbitrary provider messages. Avatar
validation retains specific translated type/size/empty-file guidance through an
exact known-message whitelist. Existing upload race guards and retry behavior are
preserved. RU/TR recovery tests cover returned and thrown provider errors.

Verification in frontend with the VITE fixture environment above:
- Focused `vitest run --maxWorkers=2` for SettingsPage, ActivityTab, login,
  RegistrationPage, reset-password, business/register, validation/schemas and
  locale-completeness: 8 files / 93 tests passed, exit 0.
- Full `vitest run --maxWorkers=2`: 152 files / 1,591 tests passed, exit 0.
- `tsc --noEmit`, `eslint . --report-unused-disable-directives --max-warnings=0`,
  `vite build`, both Git diff checks: exit 0. Build reports a chunk-size warning.
- No new browser-locale evidence for this batch yet; earlier search/UX/mobile
  browser evidence remains recorded above. No deployment or external mutation.

Remaining broader localization inventory: authenticated business registration
(including raw error presentation), submission forms, selected merchant/product,
community and admin actions. SEO and hidden planner remain excluded. Final browser
locale checks and full-contract review/evidence are still outstanding.

### L10N-1 final result — Complete, 2026-09-07

This result supersedes the preceding progress entry. The inventoried active
auth/settings, business application/listing/submission, merchant/product,
community/comment/member/compare/guide, and admin UI paths are localized in
EN/RU/TR. Existing display-label helpers translate category labels while option
values remain canonical. Dates follow the selected locale. Raw service errors in
the reviewed forms, merchant actions and admin loading paths use safe translated
messages; local validation retains actionable guidance. Annual subscription copy
now labels the existing annual price by year. No subscription amount, billing
payload, schema, API, authentication rule or backend behavior changed in L10N-1.

Provenance: parent audit-search-ux-localization, sequential Standard L10N-1;
branch `codex/audit-search-ux-localization`, worktree
`/private/tmp/alanya-audit-search-ux-localization`, HEAD
`74f63f68f346ad5abd8567b1a8f734a1077abbfe`. Root remained the sole implementation
writer under the previously explicit user exception following stalled model
writers. Independent reviewer `search_review` (Terra/high) completed the full
pass and both repair re-reviews with no remaining findings. Standard has no
separate verifier. Original checkout/unrelated audit files remain intact.

Final evidence, using existing dependencies and the VITE fixture environment above:

| Command (frontend working directory) | Final result |
| --- | --- |
| `./node_modules/.bin/vitest run --maxWorkers=2` | exit 0; 153 files / 1,601 tests |
| Focused `vitest run --maxWorkers=2` for interface-localization, locale-completeness, business/register, SubmitContentModal, both ListBusinessModal suites, BlogComments, AdminMutationFailureFeedback, BookingsAdminTab, SellerOrdersTab, MerchantDashboard, challenger-m3-adversarial | exit 0; 12 files / 98 tests |
| `./node_modules/.bin/vitest run --maxWorkers=2 src/pages/admin/__tests__/PlatformAnalyticsTab.spec.tsx` | exit 0; 1 file / 5 tests, including EN/RU/TR safe-error and retry recovery |
| `./node_modules/.bin/tsc --noEmit` | exit 0 |
| `./node_modules/.bin/eslint . --report-unused-disable-directives --max-warnings=0` | exit 0 |
| `CI=true ./node_modules/.bin/playwright test e2e/localization.spec.ts --workers=1 --reporter=line` | exit 0; 15 tests across desktop Chrome, mobile Chrome, mobile Safari |
| `vite build` via the existing Playwright webServer setup | exit 0; chunk-size warning remains |
| `git diff --check` and `git diff --cached --check` from worktree root | exit 0 |

The final browser run followed all product repairs. A subsequent test-only repair
replaced the old analytics assertion that expected a raw API error with a stronger
three-language error/retry regression; focused, full, types and lint were rerun.
Earlier intermediate full runs exposed two obsolete expectations (the modal close
label and raw analytics error); both now verify the resulting public behavior.
No tests were skipped. No frontend formatter command exists. Backend evidence from
SEARCH-1 is retained because L10N-1 did not change backend files.

Coverage includes public failures/retry/empty states, narrow catalogue layouts,
RU/TR registration navigation and member directory in real browser engines;
protected merchant/admin controls and failure transitions use controlled unit
fixtures. Live database, real payments, account creation and external messages
were not exercised. SEO, hidden planner, disabled gift-card paths and dormant
service modules remain excluded. UpgradesAddonsShowcase has no runtime consumers;
CoffeeTour/SendToPhone are reachable only from the excluded gift-card path.
No commit, push, PR or deployment was performed.

Code identity: tracked frontend/backend binary diff SHA-256
`7a35588fbfcfe290f0ee786d0b6411a4d93796361f67d28f7817f08f8798a653`.
New-file SHA-256 values (this evidence document excluded):

| File | SHA-256 |
| --- | --- |
| backend/src/users/dto/public-members-query.dto.ts | `866c0cf397d8bebc9140c3f00bb5c37356827fc3a52f6449e7d26aa06aa97e4f` |
| backend/src/users/public-search.spec.ts | `dd82e7c03bdd37d081f42fe339385f339be8b3bda86d6e7e60a1cbc77c16a41d` |
| frontend/e2e/audit-mobile.spec.ts | `57fbfe6a166d5aa42002dfd5163b4fb1193cc2433535d7b29c1b2d6c98e8c5fb` |
| frontend/e2e/search.spec.ts | `78a70aef55b75af940dd7bbe9709c86b8241f06c9e1975712fbc74d6ae860627` |
| frontend/src/i18n/auth-validation.ts | `a79a464335a44e0e69b326ea9f4bd21d20b777b7c475f6e9a938e60f6e14e4b2` |
| frontend/src/i18n/interface-localization.test.tsx | `57d8ec9f8a64baa46f4c03174aece7ccc05325428a745164bcbc8ef8bdf73588` |
| frontend/src/pages/home/components/RecentlyClaimedSection.test.tsx | `f1fdeda8d97ae07b96f5467e78c30be89a9d5bd2135c8d79a7aec426a2f448e6` |
