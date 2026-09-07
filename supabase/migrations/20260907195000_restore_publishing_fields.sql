-- These optional fields are already written by the blog and directory APIs.
-- Nullable additions preserve existing rows and all ownership/moderation rules.
ALTER TABLE public.blog_submissions
  ADD COLUMN IF NOT EXISTS author_name text,
  ADD COLUMN IF NOT EXISTS author_email text,
  ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE public.directory_listings
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS booking_url text;

NOTIFY pgrst, 'reload schema';
