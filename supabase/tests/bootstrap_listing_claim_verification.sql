\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF current_database() NOT IN (
    'claim_scenarios',
    'claim_verify',
    'claim_concurrency'
  ) THEN
    RAISE EXCEPTION 'bootstrap is restricted to a declared disposable claim test database';
  END IF;
END;
$$;

CREATE SCHEMA auth;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  email text,
  role text NOT NULL
);

CREATE TABLE public.directory_listings (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  title text,
  slug text,
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

\ir ../migrations/20260906020000_enable_imported_listing_claims.sql
