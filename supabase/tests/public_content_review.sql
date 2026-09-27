\set ON_ERROR_STOP on
-- Run after the moderation migrations in a disposable local database only.
-- Every fixture is rolled back. No production identifiers or data are used.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.forum_posts WHERE id='92600000-0000-4000-8000-000000000001') THEN
   IF NOT EXISTS(SELECT 1 FROM public.forum_posts WHERE id='92600000-0000-4000-8000-000000000001' AND moderation_status='approved') THEN RAISE EXCEPTION 'Legacy published content was hidden'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.forum_posts WHERE id='92600000-0000-4000-8000-000000000002' AND moderation_status='pending') THEN RAISE EXCEPTION 'Legacy removed content grandfathered'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.services WHERE id='92600000-0000-4000-8000-000000000004' AND moderation_status='pending') THEN RAISE EXCEPTION 'Legacy draft grandfathered'; END IF;
   UPDATE public.services SET status='approved' WHERE id='92600000-0000-4000-8000-000000000004';
   IF EXISTS(SELECT 1 FROM public.services WHERE id='92600000-0000-4000-8000-000000000004' AND moderation_status='approved') THEN RAISE EXCEPTION 'Old draft publish bypassed review'; END IF;
 END IF;
END $$;
-- Supabase normally grants table access before RLS; the lightweight fixture does not.
GRANT SELECT ON public.profiles,public.forum_posts TO anon,authenticated;
GRANT UPDATE ON public.forum_posts TO authenticated;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('92700000-0000-4000-8000-000000000001','review-admin@example.invalid','{}'),
 ('92700000-0000-4000-8000-000000000002','review-owner@example.invalid','{"full_name":"Unreviewed signup","role":"admin"}');
UPDATE public.profiles SET role='admin' WHERE id='92700000-0000-4000-8000-000000000001';
DO $$ BEGIN
 IF has_function_privilege('anon','public.is_admin()','EXECUTE') THEN RAISE EXCEPTION 'Anonymous function ACL expanded'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id='92700000-0000-4000-8000-000000000002' AND role='guest') THEN RAISE EXCEPTION 'Signup metadata escalated role'; END IF;
 IF EXISTS(SELECT 1 FROM public.profiles WHERE id='92700000-0000-4000-8000-000000000002' AND full_name='Unreviewed signup') THEN RAISE EXCEPTION 'Signup leaked'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profile_public_revisions WHERE id='92700000-0000-4000-8000-000000000002' AND changes->>'full_name'='Unreviewed signup') THEN RAISE EXCEPTION 'Signup revision missing'; END IF;
END $$;
INSERT INTO public.forum_posts(id,title,slug,body,author_id) VALUES ('92700000-0000-4000-8000-000000000003','Pending title','review-regression','Pending body','92700000-0000-4000-8000-000000000002');
UPDATE public.forum_posts SET moderation_status='approved' WHERE id='92700000-0000-4000-8000-000000000003';
DO $$ BEGIN
 IF (SELECT moderation_status FROM public.forum_posts WHERE id='92700000-0000-4000-8000-000000000003')<>'pending' THEN RAISE EXCEPTION 'Service-role payload forged approval'; END IF;
END $$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.forum_posts WHERE id='92700000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'Anonymous pending leak'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT public.review_public_content('forum_posts','92700000-0000-4000-8000-000000000003',1,true,NULL,'92700000-0000-4000-8000-000000000001');
SELECT set_config('app.content_review','',true);
DO $$ BEGIN
 IF NOT public.review_target_visible('forum_posts','92700000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'Approval did not publish'; END IF;
END $$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.forum_posts WHERE id='92700000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'Approved publication hidden from anonymous reader'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO public.forum_comments(id,post_id,author_id,body) VALUES ('92700000-0000-4000-8000-000000000004','92700000-0000-4000-8000-000000000003','92700000-0000-4000-8000-000000000001','Pending reply');
DO $$ BEGIN
 IF (SELECT comment_count FROM public.forum_posts WHERE id='92700000-0000-4000-8000-000000000003')<>0 THEN RAISE EXCEPTION 'Pending reply counted'; END IF;
 IF EXISTS(SELECT 1 FROM public.notifications WHERE data->>'commentId'='92700000-0000-4000-8000-000000000004') THEN RAISE EXCEPTION 'Pending reply notified'; END IF;
END $$;
SELECT public.review_public_content('forum_comments','92700000-0000-4000-8000-000000000004',1,true,NULL,'92700000-0000-4000-8000-000000000001');
SELECT set_config('app.content_review','',true);
DO $$ BEGIN
 IF (SELECT comment_count FROM public.forum_posts WHERE id='92700000-0000-4000-8000-000000000003')<>1 THEN RAISE EXCEPTION 'Approved reply not counted'; END IF;
 IF (SELECT count(*) FROM public.notifications WHERE data->>'commentId'='92700000-0000-4000-8000-000000000004')<>1 THEN RAISE EXCEPTION 'Approval notification missing or duplicated'; END IF;
END $$;
UPDATE public.forum_posts SET body='Changed after review' WHERE id='92700000-0000-4000-8000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"92700000-0000-4000-8000-000000000002"}',true);
UPDATE public.forum_posts SET moderation_status='approved' WHERE id='92700000-0000-4000-8000-000000000003';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.forum_posts WHERE id='92700000-0000-4000-8000-000000000003' AND moderation_status='pending') THEN RAISE EXCEPTION 'Owner preview missing or owner forged approval'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"92700000-0000-4000-8000-000000000099"}',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.forum_posts WHERE id='92700000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'Pending content leaked to other member'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$ BEGIN
 IF public.review_target_visible('forum_posts','92700000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'Edit retained approval'; END IF;
 BEGIN
   PERFORM public.review_public_content('forum_posts','92700000-0000-4000-8000-000000000003',1,true,NULL,'92700000-0000-4000-8000-000000000001');
   RAISE EXCEPTION 'Stale approval accepted';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM NOT LIKE 'Content changed;%' THEN RAISE; END IF;
 END;
END $$;
SELECT public.review_public_content('forum_posts','92700000-0000-4000-8000-000000000003',2,false,'Rejected test','92700000-0000-4000-8000-000000000001');
SELECT set_config('app.content_review','',true);
DO $$ BEGIN
 IF public.review_target_visible('forum_posts','92700000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'Rejected content visible'; END IF;
END $$;
UPDATE public.profiles SET full_name='New public name',phone='+100000000' WHERE id='92700000-0000-4000-8000-000000000002';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.profiles WHERE id='92700000-0000-4000-8000-000000000002' AND (full_name='New public name' OR phone='+100000000')) THEN RAISE EXCEPTION 'Pending profile leaked into canonical joins'; END IF;
END $$;
SELECT public.review_public_content('profile_public_revisions','92700000-0000-4000-8000-000000000002',2,true,NULL,'92700000-0000-4000-8000-000000000001');
SELECT set_config('app.content_review','',true);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id='92700000-0000-4000-8000-000000000002' AND full_name='New public name' AND phone='+100000000') THEN RAISE EXCEPTION 'Profile approval missing'; END IF;
END $$;
INSERT INTO public.service_edits(id,service_id,provider_id,changed_data) VALUES
 ('92700000-0000-4000-8000-000000000030','92600000-0000-4000-8000-000000000003','92700000-0000-4000-8000-000000000002','{"title":"Approved edited service"}'),
 ('92700000-0000-4000-8000-000000000031','92600000-0000-4000-8000-000000000003','92700000-0000-4000-8000-000000000002','{"title":"Stale parallel proposal"}');
SELECT public.review_public_content('service_edits','92700000-0000-4000-8000-000000000030',1,true,NULL,'92700000-0000-4000-8000-000000000001');
SELECT set_config('app.content_review','',true);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.services WHERE id='92600000-0000-4000-8000-000000000003' AND title='Approved edited service' AND moderation_revision=2) THEN RAISE EXCEPTION 'Service revision approval missing'; END IF;
 BEGIN
  PERFORM public.review_public_content('service_edits','92700000-0000-4000-8000-000000000031',1,true,NULL,'92700000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'Parallel stale service edit approved';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'Service changed;%' THEN RAISE; END IF; END;
END $$;
SELECT set_config('app.content_review','',true);
INSERT INTO public.blog_submissions(id,user_id,title,content,status,content_type,tag_ids)
VALUES('92700000-0000-4000-8000-000000000020','92700000-0000-4000-8000-000000000002','Reviewed guide','Original guide content','pending_review','guide','{}');
UPDATE public.blog_submissions SET content='Changed guide content' WHERE id='92700000-0000-4000-8000-000000000020';
DO $$ DECLARE published jsonb; BEGIN
 BEGIN
  PERFORM public.review_blog_submission('92700000-0000-4000-8000-000000000020',1,'92700000-0000-4000-8000-000000000001',true);
  RAISE EXCEPTION 'Stale editorial preview published';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 published:=public.review_blog_submission('92700000-0000-4000-8000-000000000020',2,'92700000-0000-4000-8000-000000000001',true);
 IF NOT public.review_target_visible('blog_posts',published->>'id') OR published->>'content'<>'Changed guide content' OR published->>'content_type'<>'guide' THEN
  RAISE EXCEPTION 'Editorial approval did not publish reviewed snapshot';
 END IF;
 IF has_function_privilege('authenticated','public.review_blog_submission(uuid,bigint,uuid,boolean,text)','EXECUTE') THEN RAISE EXCEPTION 'Editorial RPC exposed to client'; END IF;
END $$;
INSERT INTO public.blog_submissions(id,user_id,title,content,status,content_type,tag_ids)
VALUES('92700000-0000-4000-8000-000000000021','92700000-0000-4000-8000-000000000002','Rejected guide','Rejected guide content','pending_review','guide','{}');
SELECT public.review_blog_submission('92700000-0000-4000-8000-000000000021',1,'92700000-0000-4000-8000-000000000001',false,'Please improve this article');
UPDATE public.blog_submissions SET content='Improved guide after rejection' WHERE id='92700000-0000-4000-8000-000000000021';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.blog_submissions WHERE id='92700000-0000-4000-8000-000000000021' AND status='pending_review' AND moderation_revision=2) THEN RAISE EXCEPTION 'Rejected edit was not resubmitted for review'; END IF;
END $$;
ROLLBACK;
