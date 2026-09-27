-- Publish exactly the editorial submission revision inspected by an admin.
ALTER TABLE public.blog_submissions ADD COLUMN IF NOT EXISTS moderation_revision bigint NOT NULL DEFAULT 1;
-- Existing owner resubmission UI returns a rejected proposal to the review queue.
CREATE OR REPLACE FUNCTION public.validate_blog_submission_status_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF OLD.status IS NOT DISTINCT FROM NEW.status
 OR (OLD.status='pending_review' AND NEW.status IN ('approved','rejected'))
 OR (OLD.status IN ('approved','rejected') AND NEW.status='pending_review') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Invalid blog submission status transition: % -> %',OLD.status,NEW.status USING ERRCODE='check_violation';
END $$;
CREATE OR REPLACE FUNCTION public.guard_blog_submission_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN NEW.moderation_revision:=1;
 ELSE
  NEW.moderation_revision:=OLD.moderation_revision;
  IF (to_jsonb(NEW)-ARRAY['moderation_revision','updated_at','status','rejection_reason']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['moderation_revision','updated_at','status','rejection_reason']) THEN
   NEW.moderation_revision:=OLD.moderation_revision+1;
   NEW.status:='pending_review';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER blog_submission_review_revision BEFORE INSERT OR UPDATE ON public.blog_submissions
FOR EACH ROW EXECUTE FUNCTION public.guard_blog_submission_revision();

CREATE OR REPLACE FUNCTION public.review_blog_submission(p_id uuid,p_revision bigint,p_actor uuid,p_approve boolean,p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.blog_submissions; p public.blog_posts; new_id uuid:=gen_random_uuid();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_actor AND role='admin') THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM blog_submissions WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR s.status<>'pending_review' OR s.moderation_revision<>p_revision THEN
  RAISE EXCEPTION 'Submission changed; reload the preview' USING ERRCODE='40001';
 END IF;
 IF NOT p_approve THEN
  IF length(trim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'Rejection reason required'; END IF;
  UPDATE blog_submissions SET status='rejected',rejection_reason=p_reason WHERE id=p_id;
  RETURN jsonb_build_object('success',true);
 END IF;
 PERFORM set_config('app.content_review','approved',true);
 INSERT INTO blog_posts(id,title,slug,content,excerpt,category,video_url,cover_image_url,author_id,status,is_featured,content_type,published_at,moderation_status,moderation_revision)
 VALUES(new_id,s.title,trim(both '-' from regexp_replace(lower(s.title),'[^a-z0-9]+','-','g'))||'-'||new_id::text,
 s.content,left(regexp_replace(s.content,'<[^>]*>','','g'),200),s.category,s.video_url,s.media_urls[1],s.user_id,
 'published',false,coalesce(s.content_type,'blog'),now(),'approved',1) RETURNING * INTO p;
 INSERT INTO blog_post_tags(post_id,tag_id) SELECT new_id,unnest(s.tag_ids);
 UPDATE blog_submissions SET status='approved',rejection_reason=NULL WHERE id=p_id;
 RETURN to_jsonb(p);
END $$;
REVOKE ALL ON FUNCTION public.review_blog_submission(uuid,bigint,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_blog_submission(uuid,bigint,uuid,boolean,text) TO service_role;
