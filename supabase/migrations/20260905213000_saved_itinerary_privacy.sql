-- Roll out before the backend privacy enforcement. Keep this migration applied
-- during rollback; restoring the former public_read policy would expose private rows.

ALTER TABLE public.saved_itineraries
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;

UPDATE public.saved_itineraries
SET is_public = false
WHERE is_public IS NULL;

ALTER TABLE public.saved_itineraries
  ALTER COLUMN is_public SET DEFAULT false,
  ALTER COLUMN is_public SET NOT NULL;

DROP POLICY IF EXISTS "public_read" ON public.saved_itineraries;

CREATE POLICY "public_read" ON public.saved_itineraries
  FOR SELECT
  USING (is_public = true);

COMMENT ON COLUMN public.saved_itineraries.is_public IS
  'Owner-controlled publication flag; false keeps the itinerary private.';
