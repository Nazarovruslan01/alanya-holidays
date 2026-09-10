-- Ownership transfer writes the claim address into the canonical listing
-- location and preserves existing listing content when optional claim fields
-- are absent. All authorization and serialization behavior remains unchanged.
CREATE OR REPLACE FUNCTION public.approve_listing_claim(
    p_claim_id UUID,
    p_user_id UUID
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT,
  listing_id UUID
) AS $$
DECLARE
  v_claim public.listing_claims%ROWTYPE;
  v_listing public.directory_listings%ROWTYPE;
  v_is_admin BOOLEAN;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_user_id
      AND role = 'admin'
  )
  INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN QUERY
    SELECT false, 'Only admins can approve claims'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  SELECT *
  INTO v_claim
  FROM public.listing_claims
  WHERE id = p_claim_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, 'Claim not found'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF v_claim.status = 'approved' THEN
    RETURN QUERY
    SELECT true, 'Claim already approved'::TEXT, v_claim.listing_id;
    RETURN;
  END IF;

  IF v_claim.status <> 'pending' THEN
    RETURN QUERY
    SELECT false, 'Claim is not pending'::TEXT, v_claim.listing_id;
    RETURN;
  END IF;

  SELECT *
  INTO v_listing
  FROM public.directory_listings
  WHERE id = v_claim.listing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, 'Listing not found'::TEXT, v_claim.listing_id;
    RETURN;
  END IF;

  -- The listing lock serializes distinct claims targeting the same listing.
  -- Recheck every durable eligibility field after the lock so a listing that
  -- changed during moderation cannot be assigned to a stale claim.
  IF v_listing.status IS DISTINCT FROM 'approved'
     OR (
       v_listing.creation_source IS DISTINCT FROM 'admin'
       AND v_listing.creation_source IS DISTINCT FROM 'import'
     ) THEN
    RETURN QUERY
    SELECT false, 'Listing is not eligible for ownership claims'::TEXT,
      v_claim.listing_id;
    RETURN;
  END IF;

  IF v_listing.owner_user_id IS NOT NULL
     OR v_listing.claimed_at IS NOT NULL THEN
    RETURN QUERY
    SELECT false, 'Listing is already claimed'::TEXT, v_claim.listing_id;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.listing_claims AS other_claim
    WHERE other_claim.listing_id = v_claim.listing_id
      AND other_claim.status = 'approved'
      AND other_claim.id <> v_claim.id
  ) THEN
    RETURN QUERY
    SELECT false, 'Another claim is already approved'::TEXT, v_claim.listing_id;
    RETURN;
  END IF;

  UPDATE public.directory_listings
  SET
    name = CASE
      WHEN v_listing.creation_source = 'import' THEN v_listing.name
      ELSE v_claim.business_name
    END,
    whatsapp = CASE
      WHEN v_listing.creation_source = 'import' THEN v_listing.whatsapp
      ELSE v_claim.contact_phone
    END,
    website = CASE
      WHEN v_listing.creation_source = 'import'
        OR NULLIF(BTRIM(v_claim.website), '') IS NULL
        THEN v_listing.website
      ELSE v_claim.website
    END,
    location = CASE
      WHEN v_listing.creation_source = 'import'
        OR NULLIF(BTRIM(v_claim.address), '') IS NULL
        THEN v_listing.location
      ELSE v_claim.address
    END,
    short_description = CASE
      WHEN v_listing.creation_source = 'import'
        OR NULLIF(BTRIM(v_claim.description), '') IS NULL
        THEN v_listing.short_description
      ELSE v_claim.description
    END,
    owner_user_id = v_claim.user_id,
    claimed_at = now(),
    updated_at = now()
  WHERE id = v_claim.listing_id
    AND status = 'approved'
    AND creation_source IN ('admin', 'import')
    AND owner_user_id IS NULL
    AND claimed_at IS NULL;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, 'Listing is not eligible for ownership claims'::TEXT,
      v_claim.listing_id;
    RETURN;
  END IF;

  UPDATE public.listing_claims
  SET status = 'approved', updated_at = now()
  WHERE id = v_claim.id
    AND status = 'pending';

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, 'Claim is not pending'::TEXT, v_claim.listing_id;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT true, 'Claim approved successfully'::TEXT, v_claim.listing_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.approve_listing_claim(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_listing_claim(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_listing_claim(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.approve_listing_claim(UUID, UUID) TO service_role;
