-- Fix production PostgreSQL error 42883 from reject_listing_claim(UUID, TEXT, UUID)
-- caused by calling nonexistent public.is_admin(TEXT).
-- Direct admin check against public.profiles for p_user_id with role = 'admin'.

CREATE OR REPLACE FUNCTION public.reject_listing_claim(
    p_claim_id UUID,
    p_reason TEXT,
    p_user_id UUID
)
RETURNS TABLE(
  success BOOLEAN,
  message TEXT
) AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Determine admin directly from public.profiles
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_user_id
      AND role = 'admin'
  )
  INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN QUERY SELECT false, 'Only admins can reject claims'::TEXT;
    RETURN;
  END IF;

  UPDATE public.listing_claims
  SET
    status = 'rejected',
    rejection_reason = p_reason,
    updated_at = now()
  WHERE id = p_claim_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Claim not found or already processed'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'Claim rejected successfully'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Explicitly REVOKE EXECUTE from PUBLIC, anon, authenticated; GRANT only service_role.
REVOKE EXECUTE ON FUNCTION public.reject_listing_claim(UUID, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_listing_claim(UUID, TEXT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reject_listing_claim(UUID, TEXT, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reject_listing_claim(UUID, TEXT, UUID) TO service_role;
