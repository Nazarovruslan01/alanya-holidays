\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;
END;
$$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  role text NOT NULL
);

CREATE TABLE public.directory_listings (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL,
  creation_source text NOT NULL,
  owner_user_id uuid,
  claimed_at timestamptz,
  whatsapp text,
  website text,
  address text,
  short_description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  can_claim boolean GENERATED ALWAYS AS (
    creation_source = 'admin' AND claimed_at IS NULL
  ) STORED
);

CREATE TABLE public.listing_claims (
  id uuid PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES public.directory_listings(id),
  user_id uuid,
  email text NOT NULL,
  phone text NOT NULL,
  role text NOT NULL,
  additional_notes text,
  business_name text NOT NULL,
  contact_phone text NOT NULL,
  whatsapp text,
  website text,
  address text,
  description text,
  status text NOT NULL DEFAULT 'pending',
  email_verified boolean NOT NULL DEFAULT true,
  verification_expires_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_listing_claims_one_approved_per_listing
  ON public.listing_claims (listing_id)
  WHERE status = 'approved';

-- Reproduce the claim enforcement in place immediately before the migration.
CREATE OR REPLACE FUNCTION public.enforce_listing_claim_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  source_value text;
  claimed_value timestamptz;
BEGIN
  SELECT creation_source, claimed_at
    INTO source_value, claimed_value
  FROM public.directory_listings
  WHERE id = NEW.listing_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found' USING ERRCODE = '23503';
  END IF;

  IF source_value <> 'admin' OR claimed_value IS NOT NULL THEN
    RAISE EXCEPTION 'This listing is not eligible for ownership claims'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER listing_claims_enforce_eligibility
BEFORE INSERT ON public.listing_claims
FOR EACH ROW EXECUTE FUNCTION public.enforce_listing_claim_eligibility();

\ir ../migrations/20260831002000_harden_listing_claim_approval.sql

INSERT INTO public.profiles (id, role) VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin'),
  ('00000000-0000-4000-8000-000000000002', 'user'),
  ('00000000-0000-4000-8000-000000000011', 'user'),
  ('00000000-0000-4000-8000-000000000012', 'user');

INSERT INTO public.directory_listings (
  id, name, status, creation_source, owner_user_id, claimed_at
) VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'Original imported name',
    'approved',
    'import',
    NULL,
    NULL
  ),
  ('10000000-0000-4000-8000-000000000002', 'Eligible admin', 'approved', 'admin', NULL, NULL),
  ('10000000-0000-4000-8000-000000000003', 'Will become merchant', 'approved', 'admin', NULL, NULL),
  ('10000000-0000-4000-8000-000000000004', 'Unpublished import', 'pending', 'admin', NULL, NULL),
  ('10000000-0000-4000-8000-000000000005', 'Owned import', 'approved', 'admin', NULL, NULL),
  ('10000000-0000-4000-8000-000000000006', 'Claimed import', 'approved', 'admin', NULL, NULL),
  ('10000000-0000-4000-8000-000000000007', 'Historical rejected import', 'approved', 'admin', NULL, NULL);

-- These claims were valid when submitted. Mutating their listings afterwards
-- proves approval rechecks the locked current listing state.
INSERT INTO public.listing_claims (
  id, listing_id, user_id, email, phone, role, business_name, contact_phone, status
) VALUES
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000011', 'merchant@example.test', '+905550000003', 'owner', 'Merchant claim', '+905550000003', 'pending'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000011', 'unpublished@example.test', '+905550000004', 'owner', 'Unpublished claim', '+905550000004', 'pending'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000011', 'owned@example.test', '+905550000005', 'owner', 'Owned claim', '+905550000005', 'pending'),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000011', 'claimed@example.test', '+905550000006', 'owner', 'Claimed claim', '+905550000006', 'pending'),
  ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000011', 'rejected@example.test', '+905550000007', 'owner', 'Rejected import claim', '+905550000007', 'rejected');

UPDATE public.directory_listings
SET creation_source = 'merchant'
WHERE id = '10000000-0000-4000-8000-000000000003';

UPDATE public.directory_listings
SET creation_source = 'import'
WHERE id IN (
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000007'
);

UPDATE public.directory_listings
SET owner_user_id = '00000000-0000-4000-8000-000000000012'
WHERE id = '10000000-0000-4000-8000-000000000005';

UPDATE public.directory_listings
SET claimed_at = '2026-09-01T00:00:00Z'
WHERE id = '10000000-0000-4000-8000-000000000006';

UPDATE public.directory_listings
SET
  whatsapp = '+905559999999',
  website = 'https://original.example.test',
  address = 'Original imported address',
  short_description = 'Original imported description'
WHERE id = '10000000-0000-4000-8000-000000000001';

\ir ../migrations/20260906020000_enable_imported_listing_claims.sql

DO $$
DECLARE
  function_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.directory_listings
    WHERE id = '10000000-0000-4000-8000-000000000001' AND can_claim
  ) THEN
    RAISE EXCEPTION 'approved ownerless imported listing is not claimable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.directory_listings
    WHERE id = '10000000-0000-4000-8000-000000000002' AND can_claim
  ) THEN
    RAISE EXCEPTION 'approved ownerless admin listing is not claimable';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.directory_listings
    WHERE id IN (
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000005',
      '10000000-0000-4000-8000-000000000006'
    ) AND can_claim
  ) THEN
    RAISE EXCEPTION 'ineligible merchant, unpublished, owned, or claimed listing is claimable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.listing_claims
    WHERE id = '20000000-0000-4000-8000-000000000007' AND status = 'rejected'
  ) THEN
    RAISE EXCEPTION 'migration reopened a historical rejected imported claim';
  END IF;

  IF has_function_privilege('anon', 'public.approve_listing_claim(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.approve_listing_claim(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.approve_listing_claim(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'approval RPC execution grants changed';
  END IF;

  SELECT pg_get_functiondef('public.approve_listing_claim(uuid,uuid)'::regprocedure)
  INTO function_definition;
  IF (
    length(function_definition)
    - length(replace(function_definition, 'FOR UPDATE', ''))
  ) / length('FOR UPDATE') < 2 THEN
    RAISE EXCEPTION 'approval RPC no longer locks both claim and listing rows';
  END IF;
END;
$$;

INSERT INTO public.listing_claims (
  id, listing_id, user_id, email, phone, role, business_name,
  contact_phone, status, email_verified
) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', 'import-one@example.test', '+905550000001', 'owner', 'Stale imported claimant name', '+905550000001', 'pending', true),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000012', 'import-two@example.test', '+905550000002', 'owner', 'Imported competitor', '+905550000002', 'pending', true),
  ('20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000012', 'admin@example.test', '+905550000008', 'owner', 'Admin claim', '+905550000008', 'pending', true);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.directory_listings
    WHERE id IN (
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002'
    ) AND (owner_user_id IS NOT NULL OR claimed_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'claim submission or email verification assigned ownership';
  END IF;

  BEGIN
    INSERT INTO public.listing_claims (id, listing_id, user_id, email, phone, role, business_name, contact_phone)
    VALUES ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000011', 'blocked-merchant@example.test', '+905550000013', 'owner', 'Blocked merchant', '+905550000013');
    RAISE EXCEPTION 'merchant listing accepted a new claim';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.listing_claims (id, listing_id, user_id, email, phone, role, business_name, contact_phone)
    VALUES ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000011', 'blocked-unpublished@example.test', '+905550000014', 'owner', 'Blocked unpublished', '+905550000014');
    RAISE EXCEPTION 'unpublished listing accepted a new claim';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.listing_claims (id, listing_id, user_id, email, phone, role, business_name, contact_phone)
    VALUES ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000011', 'blocked-owned@example.test', '+905550000015', 'owner', 'Blocked owned', '+905550000015');
    RAISE EXCEPTION 'owned listing accepted a new claim';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.listing_claims (id, listing_id, user_id, email, phone, role, business_name, contact_phone)
    VALUES ('30000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000011', 'blocked-claimed@example.test', '+905550000016', 'owner', 'Blocked claimed', '+905550000016');
    RAISE EXCEPTION 'claimed listing accepted a new claim';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

DO $$
DECLARE
  result record;
BEGIN
  SELECT * INTO result FROM public.approve_listing_claim(
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002'
  );
  IF result.success OR result.message <> 'Only admins can approve claims' THEN
    RAISE EXCEPTION 'non-admin approved imported claim: %', row_to_json(result);
  END IF;

  SELECT * INTO result FROM public.approve_listing_claim(
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001'
  );
  IF NOT result.success OR result.message <> 'Claim approved successfully' THEN
    RAISE EXCEPTION 'admin did not approve eligible imported claim: %', row_to_json(result);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.directory_listings
    WHERE id = '10000000-0000-4000-8000-000000000001'
      AND owner_user_id = '00000000-0000-4000-8000-000000000011'
      AND claimed_at IS NOT NULL
      AND creation_source = 'import'
      AND name = 'Original imported name'
      AND whatsapp = '+905559999999'
      AND website = 'https://original.example.test'
      AND address = 'Original imported address'
      AND short_description = 'Original imported description'
      AND NOT can_claim
  ) THEN
    RAISE EXCEPTION 'approval did not assign owner while preserving imported listing content';
  END IF;

  SELECT * INTO result FROM public.approve_listing_claim(
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001'
  );
  IF NOT result.success OR result.message <> 'Claim already approved' THEN
    RAISE EXCEPTION 'repeated approval was not idempotent: %', row_to_json(result);
  END IF;

  SELECT * INTO result FROM public.approve_listing_claim(
    '20000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001'
  );
  IF result.success OR result.message <> 'Listing is already claimed' THEN
    RAISE EXCEPTION 'competing imported claim was not rejected: %', row_to_json(result);
  END IF;

  SELECT * INTO result FROM public.approve_listing_claim('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001');
  IF result.success OR result.message <> 'Listing is not eligible for ownership claims' THEN
    RAISE EXCEPTION 'merchant listing stale claim was approved: %', row_to_json(result);
  END IF;

  SELECT * INTO result FROM public.approve_listing_claim('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001');
  IF result.success OR result.message <> 'Listing is not eligible for ownership claims' THEN
    RAISE EXCEPTION 'unpublished listing stale claim was approved: %', row_to_json(result);
  END IF;

  SELECT * INTO result FROM public.approve_listing_claim('20000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001');
  IF result.success OR result.message <> 'Listing is already claimed' THEN
    RAISE EXCEPTION 'owned listing stale claim was approved: %', row_to_json(result);
  END IF;

  SELECT * INTO result FROM public.approve_listing_claim('20000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001');
  IF result.success OR result.message <> 'Listing is already claimed' THEN
    RAISE EXCEPTION 'claimed listing stale claim was approved: %', row_to_json(result);
  END IF;

  SELECT * INTO result FROM public.approve_listing_claim('20000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000001');
  IF NOT result.success THEN
    RAISE EXCEPTION 'eligible admin listing claim was not approved: %', row_to_json(result);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.directory_listings
    WHERE id = '10000000-0000-4000-8000-000000000002'
      AND name = 'Admin claim'
      AND whatsapp = '+905550000008'
      AND owner_user_id = '00000000-0000-4000-8000-000000000012'
      AND claimed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'admin listing approval no longer applies legacy claim metadata';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.listing_claims
    WHERE id = '20000000-0000-4000-8000-000000000002' AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'competing claim status changed unexpectedly';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'Imported listing claim access verification passed' AS result;
