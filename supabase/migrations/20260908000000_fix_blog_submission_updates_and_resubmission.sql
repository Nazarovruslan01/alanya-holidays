ALTER TABLE public.blog_submissions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.validate_blog_submission_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_old_status text;
  v_new_status text;
  v_allowed boolean;
BEGIN
  v_old_status := OLD.status;
  v_new_status := NEW.status;

  IF v_old_status IS NOT DISTINCT FROM v_new_status THEN
    RETURN NEW;
  END IF;

  v_allowed := CASE
    WHEN v_old_status = 'pending_review' AND v_new_status IN ('approved', 'rejected') THEN true
    WHEN v_old_status = 'approved' AND v_new_status = 'pending_review' THEN true
    WHEN v_old_status = 'rejected' AND v_new_status = 'pending_review' THEN true
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Invalid blog submission status transition: % -> %', v_old_status, v_new_status
      USING ERRCODE = 'check_violation',
            DETAIL = format('Transition from "%s" to "%s" is not allowed.', v_old_status, v_new_status);
  END IF;

  RETURN NEW;
END;
$$;
