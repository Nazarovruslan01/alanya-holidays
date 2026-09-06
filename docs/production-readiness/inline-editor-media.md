# Inline editor media production readiness

## Delivered contract

Blog submissions, blog administration, forum posts, replies, and shared content forms use the same
rich-text editor path. Images use the authenticated `/media/upload` endpoint with the existing
`forum-media/<user>/inline/` storage layout. MP4 and WebM files up to 50 MB use the authenticated
`/media/content/video` endpoint and immutable server-generated keys in the public `inline-media`
bucket. YouTube and Vimeo links are normalized to exact, script-free embed hosts.

The server sanitizes rich text at blog and forum persistence boundaries. It permits the supported
formatting tags, safe images, normalized YouTube/Vimeo frames, and native video URLs whose host is
the configured Supabase host and whose path matches the dedicated bucket layout. Browser rendering
applies the same media restrictions. Existing trusted article shortcodes remain compatible.

Video bytes must match the declared MP4 or WebM signature before a temporary file or child process
is created. `ffprobe` is then limited to the declared demuxer and the `file` protocol, has a 10-second
timeout, and must report an allowed video codec. Rejected files never reach public storage. Browser
roles have no insert, update, delete, or list policy on `inline-media`; only the authenticated server
path writes immutable objects. No credentials or caller-provided object paths are accepted.

## Rollout and rollback

Deploy in this order:

1. Apply `supabase/migrations/20260906030000_inline_media_storage.sql` and verify the bucket contract.
2. Deploy the backend with `ffprobe` available in its runtime image.
3. Deploy the frontend and nginx configuration together so the exact upload route has 52 MB of
   multipart headroom and the CSP permits the supported frame and media origins.

For rollback, disable or revert the new upload route and editor behavior. Retain the `inline-media`
bucket and every referenced object so already-published HTML continues to render. Do not drop the
bucket or delete its files as a normal rollback step.

## Verification evidence

These commands passed from the indicated project directory on 2026-09-06:

```text
frontend$ VITE_SUPABASE_URL=https://mdmizeyiyebvhkujjyjg.supabase.co VITE_SUPABASE_ANON_KEY=test-key ./node_modules/.bin/vitest run src/pages/blog/submit/page.test.tsx --reporter=verbose
12 tests passed

backend$ ./node_modules/.bin/jest --runInBand media/inline-media.service.spec.ts
8 tests passed

backend$ ./node_modules/.bin/jest --runInBand media/inline-media.ffprobe.spec.ts
1 real ffprobe test passed

frontend$ VITE_SUPABASE_URL=https://mdmizeyiyebvhkujjyjg.supabase.co VITE_SUPABASE_ANON_KEY=test-key ./node_modules/.bin/vitest run --reporter=dot
151 files, 1577 tests passed

backend$ ./node_modules/.bin/jest --runInBand
158 suites, 2143 tests passed

frontend$ ./node_modules/.bin/tsc --noEmit
passed
backend$ ./node_modules/.bin/tsc --noEmit
passed

frontend$ ./node_modules/.bin/eslint . --report-unused-disable-directives --max-warnings=0
passed with zero warnings
backend$ ./node_modules/.bin/eslint "{src,apps,libs,test}/**/*.ts"
passed with zero warnings

backend$ ./node_modules/.bin/prettier --check src/media/inline-media.service.ts src/media/inline-media.service.spec.ts src/media/inline-media.ffprobe.spec.ts
passed

frontend$ VITE_SUPABASE_URL=https://mdmizeyiyebvhkujjyjg.supabase.co VITE_SUPABASE_ANON_KEY=test-key ./node_modules/.bin/vite build
passed, 3853 modules transformed
backend$ ./node_modules/.bin/nest build
passed

frontend$ CI=1 VITE_SUPABASE_URL=https://mdmizeyiyebvhkujjyjg.supabase.co VITE_SUPABASE_ANON_KEY=test-key ./node_modules/.bin/playwright test e2e/inline-rich-text-media.spec.ts --project='Desktop Chrome' --project='Mobile Chrome (Pixel 7-like)' --reporter=line
2 tests passed

frontend$ CI=1 VITE_SUPABASE_URL=https://mdmizeyiyebvhkujjyjg.supabase.co VITE_SUPABASE_ANON_KEY=test-key ./node_modules/.bin/playwright test e2e/blog.spec.ts --project='Desktop Chrome' --project='Mobile Chrome (Pixel 7-like)' --reporter=line
8 tests passed
```

Before the repair loop, `bash scripts/test-production-deployment-contract.sh` passed its static CSP
and exact-route assertions. An isolated PostgreSQL 14 cluster accepted the migration twice and then
passed `psql -v ON_ERROR_STOP=1 -f supabase/tests/inline_media_rls.sql` inside a rollback transaction.
The CI command is pinned in `.github/workflows/ci.yml`. Independent verification on PostgreSQL
14.20 passed the migration, the RLS assertions, and an idempotent migration reapply.

### Publication CI environment repairs

Publication run `34049091894` exposed two test-environment assumptions. In the complete CI schema,
existing storage policies for other buckets can consult `profiles`, which is intentionally unreadable
to `anon`. The inline-media RLS test now treats only PostgreSQL `insufficient_privilege` as a
fail-closed listing denial; when the query is permitted, it still requires exactly zero visible rows.
No production policy, grant, role, or migration changed. PostgreSQL 14.20 reproduced the original
failure after loading `test/fixtures/init_test_db.sql` and every migration, then passed
`psql -v ON_ERROR_STOP=1 -f supabase/tests/inline_media_rls.sql` both with the CI grants and with the
referenced policy dependencies readable, exercising the explicit zero-row branch.

The deferred-upload page test also used a fixed storage origin while CI configures a mock Supabase
origin. Its fixture URL now derives from the configured test origin; the production sanitizer
allowlist is unchanged. These exact CI-environment checks passed after the repair:

```text
frontend$ VITE_SUPABASE_URL=https://mock-supabase-url.supabase.co VITE_SUPABASE_ANON_KEY=mock-supabase-anon-key ./node_modules/.bin/vitest run src/pages/blog/submit/page.test.tsx --reporter=verbose
12 tests passed

frontend$ VITE_SUPABASE_URL=https://mock-supabase-url.supabase.co VITE_SUPABASE_ANON_KEY=mock-supabase-anon-key ./node_modules/.bin/vitest run --reporter=dot
151 files, 1577 tests passed

frontend$ ./node_modules/.bin/tsc --noEmit
passed

frontend$ ./node_modules/.bin/eslint src/pages/blog/submit/page.test.tsx --report-unused-disable-directives --max-warnings=0
passed with zero warnings
```

There is no global Jest sanitizer shim. Sanitizer mocks are file-scoped in
`backend/src/admin/challenger-m3-adversarial.spec.ts`, `backend/src/blog/blog.controller.spec.ts`,
`backend/src/blog/blog.service.spec.ts`, `backend/src/forum/application/forum-discussion.service.spec.ts`,
`backend/src/forum/forum-adversarial.stress.spec.ts`,
`backend/src/forum/forum-moderation.adversarial.spec.ts`,
`backend/src/forum/forum-moderation.controller.spec.ts`, `backend/src/forum/forum.controller.spec.ts`,
and `backend/src/forum/forum.invariants.spec.ts`. Those broad suites isolate authorization and
business flow. The security assertions in `backend/src/utils/rich-text-html.spec.ts` start a
separate Node/ts-node process and load the real `sanitize-html` implementation. The Playwright
rich-text test uses the same real sanitizer process for persisted HTML. The deferred-upload mock in
`frontend/src/pages/blog/submit/page.test.tsx` is file-local and tests only the page/editor pending
state contract; RichTextEditor behavior is covered by its own focused tests and the real-Quill
Playwright run.

## Known limits

- Mobile Safari was not run because the Playwright WebKit browser is not installed. Desktop Chrome
  and the Pixel 7-like Chromium project passed.
- Nginx was checked statically because no nginx binary or Docker daemon was available for a runtime
  request test.
- Browser upload HTTP responses are mocked. Actual media-byte validation is covered separately by
  the real `ffprobe` test, and persistence sanitization runs the real backend sanitizer.
- If a validated upload succeeds but the later content save fails or is abandoned, the immutable
  object is retained. The approved lean design has no media lifecycle table or automatic orphan
  deletion.

## Provenance

- Contract: `INLINE-EDITOR-MEDIA`.
- Sole writer: `inline_media`, Sol/xhigh, selected because the work crosses upload, authentication,
  sanitization, storage, CSP, and migration trust boundaries.
- Git context: branch `codex/inline-editor-media`, worktree `/private/tmp/alanya-inline-media`, base
  `5d827985fe480ea08b617070dd33b74a493e9c1e`.
- Tested pre-document dirty hash:
  `bbd8bf4a0dfa46b4fba3b44be3d800568f51edf04a08e04698cfba19c4e9b623`.
- Terra/high review resolved both reported findings. Luna/medium independent verification passed all
  gates, including PostgreSQL 14.20 migration, RLS, and idempotent reapply checks.
- Final counts were 151 frontend files with 1,577 tests, 158 backend suites with 2,143 tests, and 10
  Chromium browser tests. Product code was unchanged by this documentation-only finalization.
