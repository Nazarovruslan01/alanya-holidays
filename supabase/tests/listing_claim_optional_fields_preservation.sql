\set ON_ERROR_STOP on

\if :{?apply_fix}
\else
\set apply_fix false
\endif

BEGIN;

-- The CI seed predates the production listing shape. Tighten only this
-- transaction to match production before exercising the approval RPC.
ALTER TABLE public.directory_listings
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS subcategory;

ALTER TABLE public.directory_listings
  ADD COLUMN IF NOT EXISTS whatsapp text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS short_description text;

UPDATE public.directory_listings
SET
  location = COALESCE(location, 'Existing fixture location'),
  short_description = COALESCE(short_description, 'Existing fixture description');

ALTER TABLE public.directory_listings
  ALTER COLUMN location SET NOT NULL,
  ALTER COLUMN short_description SET NOT NULL;

-- Reproduce the function currently deployed before proving the repair.
\ir ../migrations/20260906020000_enable_imported_listing_claims.sql

INSERT INTO auth.users (id, email)
VALUES
  ('35000000-0000-4000-8000-000000000001', 'claims-admin@example.test'),
  ('35000000-0000-4000-8000-000000000002', 'claims-user-one@example.test'),
  ('35000000-0000-4000-8000-000000000003', 'claims-user-two@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, role)
VALUES
  ('35000000-0000-4000-8000-000000000001', 'claims-admin@example.test', 'admin'),
  ('35000000-0000-4000-8000-000000000002', 'claims-user-one@example.test', 'user'),
  ('35000000-0000-4000-8000-000000000003', 'claims-user-two@example.test', 'user')
ON CONFLICT (id) DO NOTHING;

-- auth.users provisioning creates ordinary profiles in the CI fixture. Assign
-- the test administrator without weakening the production privilege trigger.
ALTER TABLE public.profiles DISABLE TRIGGER protect_profile_privileges;
UPDATE public.profiles
SET role = 'admin'
WHERE id = '35000000-0000-4000-8000-000000000001';
ALTER TABLE public.profiles ENABLE TRIGGER protect_profile_privileges;

INSERT INTO public.directory_listings (
  id,
  name,
  slug,
  status,
  creation_source,
  owner_user_id,
  claimed_at,
  whatsapp,
  website,
  location,
  short_description
)
VALUES
  (
    '36000000-0000-4000-8000-000000000001',
    'Null optionals listing',
    'claim-null-optionals-test',
    'approved',
    'admin',
    NULL,
    NULL,
    '+905550000001',
    'https://existing-null.example.test',
    'Existing null location',
    'Existing null description'
  ),
  (
    '36000000-0000-4000-8000-000000000002',
    'Blank optionals listing',
    'claim-blank-optionals-test',
    'approved',
    'admin',
    NULL,
    NULL,
    '+905550000002',
    'https://existing-blank.example.test',
    'Existing blank location',
    'Existing blank description'
  ),
  (
    '36000000-0000-4000-8000-000000000003',
    'Provided optionals listing',
    'claim-provided-optionals-test',
    'approved',
    'admin',
    NULL,
    NULL,
    '+905550000003',
    'https://existing-provided.example.test',
    'Existing provided location',
    'Existing provided description'
  ),
  (
    '36000000-0000-4000-8000-000000000004',
    'Imported listing name',
    'claim-import-preservation-test',
    'approved',
    'import',
    NULL,
    NULL,
    '+905550000004',
    'https://existing-import.example.test',
    'Existing import location',
    'Existing import description'
  );

INSERT INTO public.listing_claims (
  id,
  listing_id,
  user_id,
  email,
  phone,
  role,
  business_name,
  contact_phone,
  website,
  address,
  description,
  status,
  email_verified
)
VALUES
  (
    '37000000-0000-4000-8000-000000000001',
    '36000000-0000-4000-8000-000000000001',
    '35000000-0000-4000-8000-000000000002',
    'claims-user-one@example.test',
    '+905551000001',
    'owner',
    'Null optionals claimant name',
    '+905551000001',
    NULL,
    NULL,
    NULL,
    'pending',
    true
  ),
  (
    '37000000-0000-4000-8000-000000000002',
    '36000000-0000-4000-8000-000000000002',
    '35000000-0000-4000-8000-000000000002',
    'claims-user-one@example.test',
    '+905551000002',
    'owner',
    'Blank optionals claimant name',
    '+905551000002',
    '   ',
    '   ',
    '   ',
    'pending',
    true
  ),
  (
    '37000000-0000-4000-8000-000000000003',
    '36000000-0000-4000-8000-000000000003',
    '35000000-0000-4000-8000-000000000002',
    'claims-user-one@example.test',
    '+905551000003',
    'owner',
    'Provided optionals claimant name',
    '+905551000003',
    'https://provided.example.test',
    'Provided location',
    'Provided description',
    'pending',
    true
  ),
  (
    '37000000-0000-4000-8000-000000000004',
    '36000000-0000-4000-8000-000000000004',
    '35000000-0000-4000-8000-000000000002',
    'claims-user-one@example.test',
    '+905551000004',
    'owner',
    'Replacement import name',
    '+905551000004',
    'https://replacement-import.example.test',
    'Replacement import location',
    'Replacement import description',
    'pending',
    true
  ),
  (
    '37000000-0000-4000-8000-000000000005',
    '36000000-0000-4000-8000-000000000004',
    '35000000-0000-4000-8000-000000000003',
    'claims-user-two@example.test',
    '+905551000005',
    'owner',
    'Competing import claimant',
    '+905551000005',
    NULL,
    NULL,
    NULL,
    'pending',
    true
  );

DO $$
DECLARE
  failure_state text;
BEGIN
  BEGIN
    PERFORM *
    FROM public.approve_listing_claim(
      '37000000-0000-4000-8000-000000000001',
      '35000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'the deployed approval RPC unexpectedly accepted a table without directory_listings.address';
  EXCEPTION
    WHEN undefined_column THEN
      GET STACKED DIAGNOSTICS failure_state = RETURNED_SQLSTATE;
      IF failure_state <> '42703' THEN
        RAISE EXCEPTION 'expected SQLSTATE 42703, got %', failure_state;
      END IF;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM public.directory_listings
    WHERE id = '36000000-0000-4000-8000-000000000001'
      AND owner_user_id IS NULL
      AND claimed_at IS NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.listing_claims
    WHERE id = '37000000-0000-4000-8000-000000000001'
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'failed approval did not roll back atomically';
  END IF;
END;
$$;

\if :apply_fix
\ir ../migrations/20260908010000_fix_listing_claim_optional_fields.sql
\endif

DO $$
DECLARE
  function_definition text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'directory_listings'
      AND column_name IN ('address', 'subcategory')
  ) THEN
    RAISE EXCEPTION 'claim approval regression depends on a non-production listing column';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'directory_listings'
      AND column_name = 'location'
      AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'directory_listings'
      AND column_name = 'short_description'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'claim approval regression does not model required production listing fields';
  END IF;

  SELECT pg_get_functiondef('public.approve_listing_claim(uuid,uuid)'::regprocedure)
  INTO function_definition;

  IF function_definition LIKE '%v_listing.address%'
     OR function_definition NOT LIKE '%location = CASE%'
     OR function_definition NOT LIKE '%v_claim.address%' THEN
    RAISE EXCEPTION 'approval RPC still relies on a nonexistent listing address field';
  END IF;

  IF (
    length(function_definition)
    - length(replace(function_definition, 'FOR UPDATE', ''))
  ) / length('FOR UPDATE') < 2 THEN
    RAISE EXCEPTION 'approval RPC no longer locks both claim and listing rows';
  END IF;

  IF has_function_privilege('anon', 'public.approve_listing_claim(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.approve_listing_claim(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.approve_listing_claim(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'approval RPC execution grants changed';
  END IF;
END;
$$;

DO $$
DECLARE
  result record;
BEGIN
  SELECT * INTO result
  FROM public.approve_listing_claim(
    '37000000-0000-4000-8000-000000000001',
    '35000000-0000-4000-8000-000000000003'
  );
  IF result.success OR result.message <> 'Only admins can approve claims' THEN
    RAISE EXCEPTION 'non-admin approval was not rejected: %', row_to_json(result);
  END IF;

  SELECT * INTO result
  FROM public.approve_listing_claim(
    '37000000-0000-4000-8000-000000000001',
    '35000000-0000-4000-8000-000000000001'
  );
  IF NOT result.success OR result.message <> 'Claim approved successfully' THEN
    RAISE EXCEPTION 'null-optional claim was not approved: %', row_to_json(result);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.directory_listings
    WHERE id = '36000000-0000-4000-8000-000000000001'
      AND name = 'Null optionals claimant name'
      AND whatsapp = '+905551000001'
      AND website = 'https://existing-null.example.test'
      AND location = 'Existing null location'
      AND short_description = 'Existing null description'
      AND owner_user_id = '35000000-0000-4000-8000-000000000002'
      AND claimed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'null optional claim values did not preserve listing content during transfer';
  END IF;

  SELECT * INTO result
  FROM public.approve_listing_claim(
    '37000000-0000-4000-8000-000000000002',
    '35000000-0000-4000-8000-000000000001'
  );
  IF NOT result.success THEN
    RAISE EXCEPTION 'blank-optional claim was not approved: %', row_to_json(result);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.directory_listings
    WHERE id = '36000000-0000-4000-8000-000000000002'
      AND name = 'Blank optionals claimant name'
      AND whatsapp = '+905551000002'
      AND website = 'https://existing-blank.example.test'
      AND location = 'Existing blank location'
      AND short_description = 'Existing blank description'
  ) THEN
    RAISE EXCEPTION 'blank optional claim values did not preserve listing content';
  END IF;

  SELECT * INTO result
  FROM public.approve_listing_claim(
    '37000000-0000-4000-8000-000000000003',
    '35000000-0000-4000-8000-000000000001'
  );
  IF NOT result.success THEN
    RAISE EXCEPTION 'provided-optional claim was not approved: %', row_to_json(result);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.directory_listings
    WHERE id = '36000000-0000-4000-8000-000000000003'
      AND name = 'Provided optionals claimant name'
      AND whatsapp = '+905551000003'
      AND website = 'https://provided.example.test'
      AND location = 'Provided location'
      AND short_description = 'Provided description'
  ) THEN
    RAISE EXCEPTION 'provided optional claim values were not applied';
  END IF;

  SELECT * INTO result
  FROM public.approve_listing_claim(
    '37000000-0000-4000-8000-000000000004',
    '35000000-0000-4000-8000-000000000001'
  );
  IF NOT result.success THEN
    RAISE EXCEPTION 'import claim was not approved: %', row_to_json(result);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.directory_listings
    WHERE id = '36000000-0000-4000-8000-000000000004'
      AND name = 'Imported listing name'
      AND whatsapp = '+905550000004'
      AND website = 'https://existing-import.example.test'
      AND location = 'Existing import location'
      AND short_description = 'Existing import description'
      AND owner_user_id = '35000000-0000-4000-8000-000000000002'
      AND claimed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'import claim did not preserve listing content during transfer';
  END IF;

  SELECT * INTO result
  FROM public.approve_listing_claim(
    '37000000-0000-4000-8000-000000000004',
    '35000000-0000-4000-8000-000000000001'
  );
  IF NOT result.success OR result.message <> 'Claim already approved' THEN
    RAISE EXCEPTION 'repeated approval lost idempotent success: %', row_to_json(result);
  END IF;

  SELECT * INTO result
  FROM public.approve_listing_claim(
    '37000000-0000-4000-8000-000000000005',
    '35000000-0000-4000-8000-000000000001'
  );
  IF result.success OR result.message <> 'Listing is already claimed' THEN
    RAISE EXCEPTION 'competing claim was not rejected: %', row_to_json(result);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.listing_claims
    WHERE id = '37000000-0000-4000-8000-000000000005'
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'competing claim changed despite failed approval';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'Listing claim optional-field preservation verification passed' AS result;
