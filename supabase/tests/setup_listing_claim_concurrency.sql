\set ON_ERROR_STOP on

\ir bootstrap_listing_claim_verification.sql

INSERT INTO public.profiles (id, email, role) VALUES
  ('40000000-0000-4000-8000-000000000001', 'admin@example.test', 'admin'),
  ('40000000-0000-4000-8000-000000000011', 'first@example.test', 'user'),
  ('40000000-0000-4000-8000-000000000012', 'second@example.test', 'user');

INSERT INTO public.directory_listings (
  id, name, title, slug, status, creation_source
) VALUES (
  '50000000-0000-4000-8000-000000000001',
  'Concurrent import',
  'Concurrent import',
  'concurrent-import',
  'approved',
  'import'
);

INSERT INTO public.listing_claims (
  id, listing_id, user_id, email, phone, role, business_name, contact_phone
) VALUES
  (
    '60000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000011',
    'first@example.test',
    '+905550000001',
    'owner',
    'First concurrent claimant',
    '+905550000001'
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000012',
    'second@example.test',
    '+905550000002',
    'owner',
    'Second concurrent claimant',
    '+905550000002'
  );

COMMIT;
