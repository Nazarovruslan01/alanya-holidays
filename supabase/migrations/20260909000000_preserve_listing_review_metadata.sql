-- Preserve optional review form metadata without changing moderation defaults.
ALTER TABLE public.listing_reviews
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS visit_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'listing_reviews_visit_type_check'
      AND conrelid = 'public.listing_reviews'::regclass
  ) THEN
    ALTER TABLE public.listing_reviews
      ADD CONSTRAINT listing_reviews_visit_type_check
      CHECK (
        visit_type IS NULL
        OR visit_type IN ('Couple', 'Family', 'Solo', 'Friends', 'Business')
      );
  END IF;
END;
$$;

COMMENT ON COLUMN public.listing_reviews.title IS
  'Optional reviewer-provided title; null for legacy reviews.';
COMMENT ON COLUMN public.listing_reviews.visit_type IS
  'Optional visit context: Couple, Family, Solo, Friends, or Business.';
