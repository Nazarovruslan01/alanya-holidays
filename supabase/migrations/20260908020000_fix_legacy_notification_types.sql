-- Forum notification triggers use source-specific type names. Older databases
-- still carry a four-value CHECK from the original notification table.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
