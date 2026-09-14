\set ON_ERROR_STOP on

\if :{?apply_fix}
\else
\set apply_fix false
\endif

BEGIN;

-- The CI/local fixture omits the aggregate columns that already exist in the
-- production listing shape. Add them only for this rolled-back trigger test.
ALTER TABLE public.directory_listings
  ADD COLUMN IF NOT EXISTS reviews_average numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviews_count integer DEFAULT 0;

INSERT INTO auth.users (id, email)
VALUES
  ('41000000-0000-4000-8000-000000000001', 'review-legacy@example.test'),
  ('41000000-0000-4000-8000-000000000002', 'review-metadata@example.test'),
  ('41000000-0000-4000-8000-000000000003', 'review-invalid@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name, role)
VALUES
  ('41000000-0000-4000-8000-000000000001', 'review-legacy@example.test', 'Legacy Reviewer', 'user'),
  ('41000000-0000-4000-8000-000000000002', 'review-metadata@example.test', 'Metadata Reviewer', 'user'),
  ('41000000-0000-4000-8000-000000000003', 'review-invalid@example.test', 'Invalid Reviewer', 'user')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.directory_listings (
  id,
  name,
  slug,
  status,
  reviews_average,
  reviews_count
)
VALUES (
  '42000000-0000-4000-8000-000000000001',
  'Review metadata listing',
  'review-metadata-listing-test',
  'approved',
  0,
  0
);

-- This row predates the additive metadata migration.
INSERT INTO public.listing_reviews (
  id,
  listing_id,
  user_id,
  rating,
  comment,
  status
)
VALUES (
  '43000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  4,
  'Legacy review text',
  'pending'
);

\if :apply_fix
\ir ../migrations/20260909000000_preserve_listing_review_metadata.sql
\endif

DO $$
DECLARE
  title_nullable text;
  title_default text;
  visit_type_nullable text;
  visit_type_default text;
BEGIN
  SELECT is_nullable, column_default
  INTO title_nullable, title_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'listing_reviews'
    AND column_name = 'title'
    AND data_type = 'text';

  SELECT is_nullable, column_default
  INTO visit_type_nullable, visit_type_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'listing_reviews'
    AND column_name = 'visit_type'
    AND data_type = 'text';

  IF title_nullable IS DISTINCT FROM 'YES'
    OR title_default IS NOT NULL
    OR visit_type_nullable IS DISTINCT FROM 'YES'
    OR visit_type_default IS NOT NULL THEN
    RAISE EXCEPTION 'review metadata columns must be nullable text without defaults';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.listing_reviews
    WHERE id = '43000000-0000-4000-8000-000000000001'
      AND title IS NULL
      AND visit_type IS NULL
  ) THEN
    RAISE EXCEPTION 'additive migration changed legacy review data';
  END IF;
END;
$$;

INSERT INTO public.listing_reviews (
  id,
  listing_id,
  user_id,
  rating,
  comment,
  status,
  title,
  visit_type
)
VALUES (
  '43000000-0000-4000-8000-000000000002',
  '42000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000002',
  5,
  'Metadata review text',
  'pending',
  'A memorable visit',
  'Family'
);

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.listing_reviews
      WHERE listing_id = '42000000-0000-4000-8000-000000000001'
        AND status = 'approved') <> 0 THEN
    RAISE EXCEPTION 'pending review appeared in the approved public set';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.directory_listings
    WHERE id = '42000000-0000-4000-8000-000000000001'
      AND reviews_count = 0
      AND reviews_average = 0
  ) THEN
    RAISE EXCEPTION 'pending review changed public listing aggregates';
  END IF;
END;
$$;

UPDATE public.listing_reviews
SET status = 'approved'
WHERE id = '43000000-0000-4000-8000-000000000002';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.listing_reviews
    WHERE id = '43000000-0000-4000-8000-000000000002'
      AND status = 'approved'
      AND title = 'A memorable visit'
      AND visit_type = 'Family'
  ) THEN
    RAISE EXCEPTION 'review metadata did not survive approval and reload';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.directory_listings
    WHERE id = '42000000-0000-4000-8000-000000000001'
      AND reviews_count = 1
      AND reviews_average = 5.0
  ) THEN
    RAISE EXCEPTION 'approved review did not update public listing aggregates';
  END IF;

  BEGIN
    INSERT INTO public.listing_reviews (
      listing_id,
      user_id,
      rating,
      comment,
      visit_type
    )
    VALUES (
      '42000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000003',
      3,
      'Invalid visit type review',
      'Conference'
    );
    RAISE EXCEPTION 'unsupported visit_type unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

ROLLBACK;
