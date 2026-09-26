-- Related content participates in the same reviewed parent revision.
CREATE OR REPLACE FUNCTION public.invalidate_related_content_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE parent_table text := TG_ARGV[0]; fk text := TG_ARGV[1]; n jsonb; o jsonb;
BEGIN
 IF current_setting('app.content_review',true)='approved' AND (coalesce(auth.role(),'')='service_role' OR (auth.role() IS NULL AND auth.uid() IS NULL)) THEN RETURN NULL; END IF;
 IF TG_OP <> 'DELETE' THEN n:=to_jsonb(NEW); END IF;
 IF TG_OP <> 'INSERT' THEN o:=to_jsonb(OLD); END IF;
 IF TG_OP='UPDATE' AND (n - ARRAY['stock','updated_at']) IS NOT DISTINCT FROM (o - ARRAY['stock','updated_at']) THEN RETURN NULL; END IF;
 -- Lock/update both parents if a relationship is moved. Approval takes the same lock.
 EXECUTE format('UPDATE public.%I SET moderation_status=''pending'',moderation_revision=moderation_revision+1,moderation_reason=NULL WHERE id::text=$1 OR id::text=$2',parent_table) USING n->>fk,o->>fk;
 RETURN NULL;
END $$;
DO $$
DECLARE x text[];
BEGIN
 FOREACH x SLICE 1 IN ARRAY ARRAY[['product_variants','products','product_id'],['product_skus','product_items','product_id'],['blog_post_tags','blog_posts','post_id'],['listing_locations','directory_listings','listing_id']] LOOP
   IF to_regclass('public.'||x[1]) IS NOT NULL THEN
     EXECUTE format('CREATE TRIGGER invalidate_parent_review AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.invalidate_related_content_review(%L,%L)',x[1],x[2],x[3]);
   END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.review_target_visible(p_table text,p_id text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb; parent_row jsonb; parent_id text; seen text[] := ARRAY[p_id];
BEGIN
 IF public.review_content_fields(p_table) IS NULL THEN RETURN false; END IF;
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id::text=$1',p_table) INTO r USING p_id;
 IF r IS NULL OR r->>'moderation_status'<>'approved' OR coalesce((r->>'is_removed')::boolean,false) OR coalesce((r->>'is_hidden')::boolean,false) THEN RETURN false; END IF;
 IF r ? 'status' AND r->>'status' NOT IN ('approved','published','active') THEN RETURN false; END IF;
 IF p_table='forum_events' AND NOT coalesce((r->>'is_published')::boolean,false) THEN RETURN false; END IF;
 IF p_table='saved_itineraries' AND NOT coalesce((r->>'is_public')::boolean,false) THEN RETURN false; END IF;
 IF p_table IN ('forum_comments','blog_comments') THEN
   parent_id:=r->>'parent_id';
   WHILE parent_id IS NOT NULL LOOP
     IF parent_id=ANY(seen) OR cardinality(seen)>100 THEN RETURN false; END IF;
     seen:=array_append(seen,parent_id);
     EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id::text=$1',p_table) INTO parent_row USING parent_id;
     IF parent_row IS NULL OR parent_row->>'moderation_status'<>'approved' OR coalesce((parent_row->>'is_removed')::boolean,false) OR parent_row->>'post_id' IS DISTINCT FROM r->>'post_id' THEN RETURN false; END IF;
     parent_id:=parent_row->>'parent_id';
   END LOOP;
   RETURN public.review_target_visible(CASE WHEN p_table='forum_comments' THEN 'forum_posts' ELSE 'blog_posts' END,r->>'post_id');
 END IF;
 RETURN true;
END $$;
CREATE POLICY reviewed_parent ON public.forum_comments AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (public.review_target_visible('forum_comments',id::text) OR author_id=(SELECT auth.uid()) OR (auth.uid() IS NOT NULL AND public.is_admin()));
CREATE POLICY reviewed_parent ON public.blog_comments AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (public.review_target_visible('blog_comments',id::text) OR user_id=(SELECT auth.uid()) OR (auth.uid() IS NOT NULL AND public.is_admin()));
CREATE POLICY reviewed_parent ON public.product_variants AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (public.review_target_visible('products',product_id::text) OR (auth.uid() IS NOT NULL AND public.is_admin()) OR EXISTS(SELECT 1 FROM public.products p WHERE p.id=product_id AND p.seller_id=(SELECT auth.uid())));
CREATE POLICY reviewed_parent ON public.product_skus AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (public.review_target_visible('product_items',product_id::text) OR (auth.uid() IS NOT NULL AND public.is_admin()) OR EXISTS(SELECT 1 FROM public.product_items p WHERE p.id=product_id AND p.seller_id=(SELECT auth.uid())));

CREATE OR REPLACE FUNCTION public.forum_sync_comment_count() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE public.forum_posts p SET comment_count=(SELECT count(*) FROM public.forum_comments c WHERE c.post_id=p.id AND public.review_target_visible('forum_comments',c.id::text))
 WHERE p.id=CASE WHEN TG_OP='DELETE' THEN OLD.post_id ELSE NEW.post_id END;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_forum_comment_count ON public.forum_comments;
CREATE TRIGGER trg_forum_comment_count AFTER INSERT OR UPDATE OR DELETE ON public.forum_comments FOR EACH ROW EXECUTE FUNCTION public.forum_sync_comment_count();
CREATE OR REPLACE FUNCTION public.blog_sync_comment_count() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE public.blog_posts p SET comment_count=(SELECT count(*) FROM public.blog_comments c WHERE c.post_id=p.id AND public.review_target_visible('blog_comments',c.id::text))
 WHERE p.id=CASE WHEN TG_OP='DELETE' THEN OLD.post_id ELSE NEW.post_id END;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_blog_comment_count ON public.blog_comments;
CREATE TRIGGER trg_blog_comment_count AFTER INSERT OR UPDATE OR DELETE ON public.blog_comments FOR EACH ROW EXECUTE FUNCTION public.blog_sync_comment_count();

CREATE OR REPLACE FUNCTION public.get_related_posts(p_post_id uuid,p_category text,p_limit int DEFAULT 3)
RETURNS TABLE(id uuid,title text,slug text,excerpt text,cover_image_url text,category text,published_at timestamptz,author jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT bp.id,bp.title,bp.slug,bp.excerpt,bp.cover_image_url,bp.category,bp.published_at,jsonb_build_object('full_name',pr.full_name,'avatar_url',pr.avatar_url)
 FROM public.blog_posts bp LEFT JOIN public.profiles pr ON pr.id=bp.author_id
 WHERE bp.status='published' AND bp.moderation_status='approved' AND bp.content_type='blog' AND bp.id<>p_post_id
 ORDER BY (bp.category=p_category) DESC NULLS LAST,bp.published_at DESC,bp.id
 LIMIT greatest(0,least(p_limit,50))
$$;

-- Legacy property RPC bodies are not versioned. Keep them backend-only; their
-- API callers enforce approved status and moderation after the RPC response.
REVOKE EXECUTE ON FUNCTION public.get_available_properties(date,date) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.get_property_by_ref_id(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_properties(date,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_property_by_ref_id(integer) TO service_role;
-- The authenticated HTTP forum path supplies the verified author identity.
REVOKE EXECUTE ON FUNCTION public.create_question_post(text,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_question_post(text,text,uuid,uuid) TO service_role;

-- Existing notification builders remain the source of recipient and copy rules.
-- Suppress unpublished targets and deliver a comment notification on approval.
CREATE OR REPLACE FUNCTION public.guard_reviewed_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target_table text; target_id text;
BEGIN
 IF NEW.type::text LIKE 'FORUM_%' THEN
   target_table:=CASE WHEN NEW.data ? 'commentId' THEN 'forum_comments' ELSE 'forum_posts' END;
   target_id:=coalesce(NEW.data->>'commentId',NEW.data->>'postId');
 ELSIF NEW.type::text LIKE 'BLOG_%' THEN
   target_table:=CASE WHEN NEW.data ? 'commentId' THEN 'blog_comments' ELSE 'blog_posts' END;
   target_id:=coalesce(NEW.data->>'commentId',NEW.data->>'blogId',NEW.data->>'postId');
 END IF;
 IF target_table IS NOT NULL AND (target_id IS NULL OR NOT public.review_target_visible(target_table,target_id)) THEN RETURN NULL; END IF;
 IF NEW.data ? 'commentId' AND NEW.type::text IN ('FORUM_COMMENT','FORUM_REPLY','BLOG_COMMENT','BLOG_REPLY') AND EXISTS(
   SELECT 1 FROM public.notifications n WHERE n.user_id=NEW.user_id AND n.type=NEW.type AND n.data->>'commentId'=NEW.data->>'commentId'
 ) THEN RETURN NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_reviewed_notification BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.guard_reviewed_notification();
DROP TRIGGER IF EXISTS trg_notify_forum_comment ON public.forum_comments;
CREATE TRIGGER trg_notify_forum_comment AFTER INSERT OR UPDATE OF moderation_status ON public.forum_comments FOR EACH ROW EXECUTE FUNCTION public.handle_forum_comment_notification();
DROP TRIGGER IF EXISTS trg_notify_blog_comment ON public.blog_comments;
CREATE TRIGGER trg_notify_blog_comment AFTER INSERT OR UPDATE OF moderation_status ON public.blog_comments FOR EACH ROW EXECUTE FUNCTION public.handle_blog_comment_notification();

CREATE OR REPLACE FUNCTION public.sync_listing_review_stats() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE public.directory_listings d SET
   reviews_count=(SELECT count(*) FROM public.listing_reviews r WHERE r.listing_id=d.id AND r.status='approved' AND r.moderation_status='approved'),
   reviews_average=coalesce((SELECT round(avg(r.rating)::numeric,1) FROM public.listing_reviews r WHERE r.listing_id=d.id AND r.status='approved' AND r.moderation_status='approved'),0)
 WHERE d.id=CASE WHEN TG_OP='DELETE' THEN OLD.listing_id ELSE NEW.listing_id END;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_sync_listing_review_stats ON public.listing_reviews;
CREATE TRIGGER trg_sync_listing_review_stats AFTER INSERT OR UPDATE OR DELETE ON public.listing_reviews FOR EACH ROW EXECUTE FUNCTION public.sync_listing_review_stats();

CREATE OR REPLACE FUNCTION public.review_visible_comment_ids(p_table text,p_ids text[]) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(array_agg(id),'{}'::text[]) FROM unnest(p_ids) id
 WHERE p_table IN ('forum_comments','blog_comments') AND public.review_target_visible(p_table,id)
$$;
REVOKE ALL ON FUNCTION public.review_visible_comment_ids(text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_visible_comment_ids(text,text[]) TO service_role;
