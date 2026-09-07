-- Schema contract regression. No fixtures or user data are changed.
BEGIN;
DO $$
DECLARE
  field record;
BEGIN
  FOR field IN SELECT * FROM (VALUES
    ('blog_submissions', 'author_name'),
    ('blog_submissions', 'author_email'),
    ('blog_submissions', 'category'),
    ('directory_listings', 'description'),
    ('directory_listings', 'booking_url')
  ) AS fields(table_name, column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = field.table_name
        AND c.column_name = field.column_name
        AND c.data_type = 'text' AND c.is_nullable = 'YES'
    ) THEN
      RAISE EXCEPTION 'Missing nullable text field %.%', field.table_name, field.column_name;
    END IF;
  END LOOP;
END $$;
ROLLBACK;
