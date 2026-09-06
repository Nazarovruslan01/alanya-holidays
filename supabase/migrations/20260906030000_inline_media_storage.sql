-- Validated rich-text videos are written only by the backend service-role client.
-- The bucket is public so immutable URLs embedded in published content remain
-- readable; no storage.objects write policy is created for browser roles.
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'inline-media',
  'inline-media',
  true,
  52428800,
  ARRAY['video/mp4', 'video/webm']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "inline_media_select_public" ON storage.objects;
DROP POLICY IF EXISTS "inline_media_insert_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "inline_media_update_owner" ON storage.objects;
DROP POLICY IF EXISTS "inline_media_delete_owner" ON storage.objects;
