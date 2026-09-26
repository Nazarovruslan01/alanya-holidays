#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PGDATABASE:?Set PGDATABASE to an empty disposable moderation_* database}"
export PGHOST=127.0.0.1
export PGPORT="${PGPORT:-55473}"
export PGUSER="${PGUSER:-postgres}"
case "$PGDATABASE" in moderation_*) ;; *) echo 'Only disposable moderation_* databases are allowed' >&2; exit 1;; esac
psql -X -v ON_ERROR_STOP=1 -f test/fixtures/init_test_db.sql
for migration in supabase/migrations/*.sql; do
  if [[ "$migration" == *20260927000000_public_content_review.sql ]]; then
    psql -X -v ON_ERROR_STOP=1 -f supabase/tests/public_content_legacy_fixture.sql
  fi
  psql -X -v ON_ERROR_STOP=1 -f "$migration"
done
psql -X -v ON_ERROR_STOP=1 -f supabase/tests/public_content_review.sql
