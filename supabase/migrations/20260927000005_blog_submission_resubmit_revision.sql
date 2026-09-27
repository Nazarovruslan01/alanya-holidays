CREATE OR REPLACE FUNCTION public.guard_blog_submission_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.moderation_revision:=1;
 ELSE
  NEW.moderation_revision:=OLD.moderation_revision;
  IF OLD.status='rejected' AND NEW.status='pending_review' THEN
   NEW.moderation_revision:=OLD.moderation_revision+1;
   NEW.rejection_reason:=NULL;
  ELSIF (to_jsonb(NEW)-ARRAY['moderation_revision','updated_at','status','rejection_reason']) IS DISTINCT FROM
        (to_jsonb(OLD)-ARRAY['moderation_revision','updated_at','status','rejection_reason']) THEN
   NEW.moderation_revision:=OLD.moderation_revision+1;
   NEW.status:='pending_review';
   NEW.rejection_reason:=NULL;
  END IF;
 END IF;
 RETURN NEW;
END $$;

UPDATE public.blog_submissions
SET rejection_reason = NULL
WHERE status = 'pending_review'
  AND rejection_reason IS NOT NULL;
