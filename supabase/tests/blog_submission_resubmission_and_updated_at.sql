\set ON_ERROR_STOP on

\if :{?apply_fix}
\else
\set apply_fix false
\endif

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('20000000-0000-0000-0000-000000000001', 'submission-one@example.test'),
  ('20000000-0000-0000-0000-000000000002', 'submission-two@example.test'),
  ('20000000-0000-0000-0000-000000000003', 'submission-three@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name, role)
VALUES
  ('20000000-0000-0000-0000-000000000001', 'submission-one@example.test', 'Submission One', 'user'),
  ('20000000-0000-0000-0000-000000000002', 'submission-two@example.test', 'Submission Two', 'user'),
  ('20000000-0000-0000-0000-000000000003', 'submission-three@example.test', 'Submission Three', 'user')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.blog_submissions (
  id,
  user_id,
  title,
  content,
  status,
  rejection_reason
)
VALUES
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Rejected', 'Original', 'rejected', 'Needs revision'),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Review', 'Matrix', 'pending_review', NULL),
  ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'Approved', 'Invalid', 'approved', NULL);

\if :apply_fix
\ir ../migrations/20260908000000_fix_blog_submission_updates_and_resubmission.sql
\endif

DO $$
DECLARE
  migration_column_type text;
  migration_column_nullable text;
  migration_column_default text;
BEGIN
  SELECT c.data_type, c.is_nullable, c.column_default
  INTO migration_column_type, migration_column_nullable, migration_column_default
  FROM information_schema.columns AS c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'blog_submissions'
    AND c.column_name = 'updated_at';

  IF migration_column_type IS DISTINCT FROM 'timestamp with time zone'
    OR migration_column_nullable IS DISTINCT FROM 'YES'
    OR migration_column_default IS NOT NULL THEN
    RAISE EXCEPTION 'updated_at must be a nullable timestamptz without a fabricated-history default';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.blog_submissions
    WHERE id = '10000000-0000-0000-0000-000000000001'
      AND title = 'Rejected'
      AND content = 'Original'
      AND status = 'rejected'
      AND rejection_reason = 'Needs revision'
      AND updated_at IS NULL
  ) THEN
    RAISE EXCEPTION 'the additive migration changed existing submission data';
  END IF;
END;
$$;

UPDATE public.blog_submissions
SET title = 'Saved title', updated_at = clock_timestamp()
WHERE id = '10000000-0000-0000-0000-000000000001';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.blog_submissions
    WHERE id = '10000000-0000-0000-0000-000000000001'
      AND title = 'Saved title'
      AND updated_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'submission text and updated_at did not save and reload together';
  END IF;
END;
$$;

UPDATE public.blog_submissions
SET status = 'pending_review', rejection_reason = NULL
WHERE id = '10000000-0000-0000-0000-000000000001';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.blog_submissions
    WHERE id = '10000000-0000-0000-0000-000000000001'
      AND status = 'pending_review'
      AND rejection_reason IS NULL
  ) THEN
    RAISE EXCEPTION 'resubmission did not change status and clear the rejection reason atomically';
  END IF;
END;
$$;

UPDATE public.blog_submissions
SET status = 'approved'
WHERE id = '10000000-0000-0000-0000-000000000002';

UPDATE public.blog_submissions
SET status = 'pending_review'
WHERE id = '10000000-0000-0000-0000-000000000002';

UPDATE public.blog_submissions
SET status = 'rejected'
WHERE id = '10000000-0000-0000-0000-000000000002';

DO $$
BEGIN
  BEGIN
    UPDATE public.blog_submissions
    SET status = 'rejected'
    WHERE id = '10000000-0000-0000-0000-000000000003';
    RAISE EXCEPTION 'approved -> rejected unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid = 'public.validate_blog_submission_status_transition()'::regprocedure
      AND proconfig @> ARRAY['search_path=public']
  ) THEN
    RAISE EXCEPTION 'status transition function search_path is not hardened';
  END IF;
END;
$$;

ROLLBACK;
