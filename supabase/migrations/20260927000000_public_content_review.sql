-- MOD-20260927: user authorized moderation of all public user content and edits,
-- explicitly preserving existing publications. This additive source migration is
-- validated only on disposable local PostgreSQL; deployment is a separate action.
-- Catalog-confirmed legacy differences: preserve current product visibility and
-- accept the existing application roles and publication states.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK(role IN ('guest','user','host','artisan','admin'));
ALTER TABLE public.service_edits DROP CONSTRAINT IF EXISTS service_edits_status_check;
ALTER TABLE public.service_edits ADD CONSTRAINT service_edits_status_check CHECK(status IN ('pending','approved','rejected'));
ALTER TABLE public.services DROP CONSTRAINT IF EXISTS check_service_status;
ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_status_check;
ALTER TABLE public.services ADD CONSTRAINT services_status_check CHECK(status IN ('draft','pending','approved','rejected'));
CREATE OR REPLACE FUNCTION public.review_content_fields(p_table text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
 SELECT CASE p_table
 WHEN 'directory_listings' THEN ARRAY['name','title','slug','description','descriptions','short_description','gallery','category_id','category','subcategory','address','location','phone','email','website','social_links','video_url','booking_url','whatsapp','price_level','google_map_url','certifications','languages_spoken']
 WHEN 'services' THEN ARRAY['title','description','type','service_type','category','duration_minutes','brand','model','images','image_url','location','price','price_per_day','details','features','currency','price_unit','capacity','promotion_description','promotion_price']
 WHEN 'service_edits' THEN ARRAY['changed_data']
 WHEN 'properties' THEN ARRAY['title','description','images','image_url','location','address','amenities','price_per_night','type','bedrooms','bathrooms','max_guests','currency','cleaning_fee','min_stay_nights','beds']
 WHEN 'products' THEN ARRAY['name','title','description','images','image_url','price','category_id','category','variants']
 WHEN 'product_items' THEN ARRAY['name','description','media','price','currency','category_id']
 WHEN 'forum_events' THEN ARRAY['title','description','location','event_date','image_url','video_url','category_id','image_media_id','video_media_id']
 WHEN 'listing_reviews' THEN ARRAY['rating','comment','title','visit_type']
 WHEN 'reviews' THEN ARRAY['rating','comment','title','content']
 WHEN 'blog_posts' THEN ARRAY['title','content','excerpt','cover_image_url','video_url','category','slug','content_type']
 WHEN 'forum_posts' THEN ARRAY['title','body','slug','category_id','image_url','post_type']
 WHEN 'forum_comments' THEN ARRAY['body','parent_id','post_id']
 WHEN 'blog_comments' THEN ARRAY['body','parent_id','post_id']
 WHEN 'saved_itineraries' THEN ARRAY['title','params','itinerary','is_public']
 ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION public.guard_public_content_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n jsonb := to_jsonb(NEW); o jsonb; changed boolean := TG_OP = 'INSERT';
 fields text[] := public.review_content_fields(TG_TABLE_NAME); k text;
 trusted boolean := coalesce(auth.role(), '') = 'service_role' OR (auth.role() IS NULL AND auth.uid() IS NULL);
 admin_actor boolean := EXISTS(SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
BEGIN
 IF TG_OP = 'UPDATE' THEN
   o := to_jsonb(OLD);
   FOREACH k IN ARRAY fields LOOP
     IF n->k IS DISTINCT FROM o->k THEN changed := true; END IF;
   END LOOP;
   IF n->'status' IS DISTINCT FROM o->'status' AND n->>'status' IN ('approved','active','published') THEN changed := true; END IF;
   IF n->>'is_published'='true' AND o->>'is_published' IS DISTINCT FROM 'true' THEN changed := true; END IF;
 END IF;
 IF current_setting('app.content_review', true) = 'approved' AND trusted THEN RETURN NEW; END IF;
 IF TG_OP = 'INSERT' THEN
   n := n || jsonb_build_object('moderation_status','pending','moderation_revision',1,'moderation_reason',NULL);
 ELSIF changed THEN
   n := n || jsonb_build_object('moderation_status','pending','moderation_revision',(o->>'moderation_revision')::bigint+1,'moderation_reason',NULL);
 ELSIF NOT (
   n->>'moderation_status'='pending' AND
   (n->>'moderation_revision')::bigint=(o->>'moderation_revision')::bigint+1
 ) THEN
   n := n || jsonb_build_object('moderation_status',o->>'moderation_status','moderation_revision',o->'moderation_revision','moderation_reason',o->'moderation_reason');
 END IF;
 IF NOT trusted AND NOT admin_actor THEN
   IF TG_TABLE_NAME = 'directory_listings' THEN
     n := n || jsonb_build_object('tier',coalesce(o->>'tier','explorer'),'is_premium',coalesce(o->'is_premium','false'::jsonb));
   END IF;
   IF n ? 'status' AND n->>'status' IN ('approved','active','published') AND n->>'moderation_status' <> 'approved' THEN
     n := n || jsonb_build_object('status',CASE WHEN TG_TABLE_NAME IN ('products','product_items','blog_posts') THEN 'draft' ELSE 'pending' END);
   END IF;
   IF TG_TABLE_NAME = 'forum_events' AND n->>'moderation_status' <> 'approved' THEN n := n || '{"is_published":false}'::jsonb; END IF;
 END IF;
 NEW := jsonb_populate_record(NEW,n); RETURN NEW;
END $$;

DO $$
DECLARE t text; owner_column text;
BEGIN
 FOREACH t IN ARRAY ARRAY['directory_listings','services','properties','products','product_items','forum_events','listing_reviews','reviews','blog_posts','forum_posts','forum_comments','blog_comments','saved_itineraries'] LOOP
   IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
   EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT ''approved'' CHECK (moderation_status IN (''pending'',''approved'',''rejected'')), ADD COLUMN IF NOT EXISTS moderation_revision bigint NOT NULL DEFAULT 1, ADD COLUMN IF NOT EXISTS moderation_reason text',t);
   -- Grandfather only rows already public under the existing domain predicate.
   IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='status') THEN
     EXECUTE format('UPDATE public.%I SET moderation_status=''pending'' WHERE status IS DISTINCT FROM %L',t,CASE WHEN t IN ('products','product_items') THEN 'active' WHEN t='blog_posts' THEN 'published' ELSE 'approved' END);
   ELSIF t='forum_events' THEN EXECUTE 'UPDATE public.forum_events SET moderation_status=''pending'' WHERE NOT is_published';
   ELSIF t='saved_itineraries' THEN EXECUTE 'UPDATE public.saved_itineraries SET moderation_status=''pending'' WHERE NOT is_public';
   ELSIF t IN ('forum_posts','forum_comments','blog_comments') THEN EXECUTE format('UPDATE public.%I SET moderation_status=''pending'' WHERE is_removed',t);
   ELSIF t='reviews' THEN EXECUTE 'UPDATE public.reviews SET moderation_status=''pending'' WHERE is_hidden';
   END IF;
   EXECUTE format('ALTER TABLE public.%I ALTER COLUMN moderation_status SET DEFAULT ''pending''',t);
   EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (moderation_status, id)',t||'_review_queue_idx',t);
   EXECUTE format('CREATE TRIGGER guard_public_content_review BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_public_content_review()',t);
   owner_column := CASE t WHEN 'directory_listings' THEN 'owner_user_id' WHEN 'services' THEN 'provider_id' WHEN 'properties' THEN 'host_id' WHEN 'products' THEN 'seller_id' WHEN 'product_items' THEN 'seller_id' WHEN 'forum_events' THEN 'host_id' WHEN 'blog_posts' THEN 'author_id' WHEN 'forum_posts' THEN 'author_id' WHEN 'forum_comments' THEN 'author_id' ELSE 'user_id' END;
   IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name=owner_column) THEN
     EXECUTE format('CREATE POLICY content_review_visibility ON public.%I AS RESTRICTIVE FOR SELECT TO anon, authenticated USING (moderation_status = ''approved'' OR %I = (SELECT auth.uid()) OR (CASE WHEN auth.uid() IS NULL THEN false ELSE public.is_admin() END))',t,owner_column);
   ELSE
     EXECUTE format('CREATE POLICY content_review_visibility ON public.%I AS RESTRICTIVE FOR SELECT TO anon, authenticated USING (moderation_status = ''approved'' OR (CASE WHEN auth.uid() IS NULL THEN false ELSE public.is_admin() END))',t);
   END IF;
 END LOOP;
END $$;

ALTER TABLE public.service_edits ADD COLUMN moderation_status text NOT NULL DEFAULT 'pending', ADD COLUMN moderation_revision bigint NOT NULL DEFAULT 1, ADD COLUMN moderation_reason text, ADD COLUMN base_revision bigint;
UPDATE public.service_edits e SET base_revision=s.moderation_revision FROM public.services s WHERE s.id=e.service_id;
CREATE OR REPLACE FUNCTION public.capture_service_edit_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 SELECT moderation_revision INTO NEW.base_revision FROM public.services WHERE id=NEW.service_id;
 RETURN NEW;
END $$;
CREATE TRIGGER capture_service_edit_revision BEFORE INSERT ON public.service_edits FOR EACH ROW EXECUTE FUNCTION public.capture_service_edit_revision();
CREATE TRIGGER guard_public_content_review BEFORE INSERT OR UPDATE ON public.service_edits FOR EACH ROW EXECUTE FUNCTION public.guard_public_content_review();

CREATE TABLE public.profile_public_revisions (
 id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 changes jsonb NOT NULL,
 moderation_status text NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending','approved','rejected')),
 moderation_revision bigint NOT NULL DEFAULT 1,
 moderation_reason text,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profile_public_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY profile_revision_read ON public.profile_public_revisions FOR SELECT TO authenticated USING (id=(SELECT auth.uid()) OR (CASE WHEN auth.uid() IS NULL THEN false ELSE public.is_admin() END));
GRANT SELECT ON public.profile_public_revisions TO authenticated;
GRANT ALL ON public.profile_public_revisions TO service_role;

CREATE OR REPLACE FUNCTION public.stage_profile_public_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE changes jsonb := '{}'; k text; n jsonb := to_jsonb(NEW); o jsonb := CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
BEGIN
 IF current_setting('app.content_review',true) = 'approved' AND (coalesce(auth.role(),'')='service_role' OR (auth.role() IS NULL AND auth.uid() IS NULL)) THEN RETURN NEW; END IF;
 FOREACH k IN ARRAY ARRAY['full_name','avatar_url','bio','company_name','social_links','phone','email'] LOOP
   IF n->k IS DISTINCT FROM o->k THEN changes := changes || jsonb_build_object(k,n->k); END IF;
   IF TG_OP='UPDATE' THEN n := n || jsonb_build_object(k,o->k);
   ELSE n := n || jsonb_build_object(k,CASE WHEN k='full_name' THEN '"Community member"'::jsonb ELSE 'null'::jsonb END); END IF;
 END LOOP;
 IF TG_OP='UPDATE' AND changes <> '{}'::jsonb THEN
   INSERT INTO public.profile_public_revisions(id,changes) VALUES(NEW.id,changes)
   ON CONFLICT(id) DO UPDATE SET changes=profile_public_revisions.changes||EXCLUDED.changes, moderation_status='pending', moderation_reason=NULL, moderation_revision=profile_public_revisions.moderation_revision+1;
 END IF;
 IF TG_OP='INSERT' AND coalesce(auth.role(),'') <> 'service_role' AND auth.uid() IS NOT NULL THEN n := n || '{"role":"guest"}'::jsonb; END IF;
 NEW := jsonb_populate_record(NEW,n); RETURN NEW;
END $$;
CREATE TRIGGER stage_profile_public_changes BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.stage_profile_public_changes();

CREATE OR REPLACE FUNCTION public.stage_signup_public_changes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m jsonb;
BEGIN
 SELECT coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('email',email) INTO m FROM auth.users WHERE id=NEW.id;
 IF m IS NOT NULL THEN
   m := jsonb_strip_nulls(jsonb_build_object('full_name',coalesce(m->'full_name',m->'name'),'avatar_url',m->'avatar_url','company_name',m->'company_name','email',m->'email'));
   IF m <> '{}'::jsonb THEN INSERT INTO public.profile_public_revisions(id,changes) VALUES(NEW.id,m) ON CONFLICT(id) DO NOTHING; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stage_signup_public_changes AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.stage_signup_public_changes();

CREATE OR REPLACE FUNCTION public.review_public_content(p_table text,p_id text,p_revision bigint,p_approve boolean,p_reason text,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE row_data jsonb; patch jsonb; result jsonb; target regclass; service_row public.services; field_name text; assignments text;
BEGIN
 IF coalesce(auth.role(),'') <> 'service_role' AND NOT(auth.role() IS NULL AND auth.uid() IS NULL) THEN RAISE EXCEPTION 'Service role required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND role='admin') THEN RAISE EXCEPTION 'Administrator required'; END IF;
 IF public.review_content_fields(p_table) IS NULL AND p_table <> 'profile_public_revisions' THEN RAISE EXCEPTION 'Invalid content type'; END IF;
 target := to_regclass('public.'||p_table);
 EXECUTE format('SELECT to_jsonb(t) FROM %s t WHERE id::text=$1 FOR UPDATE',target) INTO row_data USING p_id;
 IF row_data IS NULL OR (row_data->>'moderation_revision')::bigint <> p_revision THEN RAISE EXCEPTION 'Content changed; reload the review'; END IF;
 IF row_data->>'moderation_status' <> 'pending' THEN RAISE EXCEPTION 'Content is not awaiting review'; END IF;
 PERFORM set_config('app.content_review','approved',true);
 patch := jsonb_build_object('moderation_status',CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,'moderation_reason',CASE WHEN p_approve THEN NULL ELSE p_reason END);
 IF NOT p_approve THEN
   IF p_table IN ('directory_listings','services','properties','listing_reviews','service_edits') THEN patch:=patch||'{"status":"rejected"}'::jsonb;
   ELSIF p_table IN ('products','product_items') THEN patch:=patch||'{"status":"inactive"}'::jsonb;
   ELSIF p_table='blog_posts' THEN patch:=patch||'{"status":"draft"}'::jsonb;
   ELSIF p_table='forum_events' THEN patch:=patch||'{"is_published":false}'::jsonb;
   END IF;
 END IF;
 IF p_approve THEN
   IF p_table='service_edits' THEN
     SELECT * INTO service_row FROM public.services WHERE id=(row_data->>'service_id')::uuid FOR UPDATE;
     IF service_row.moderation_revision IS DISTINCT FROM (row_data->>'base_revision')::bigint THEN RAISE EXCEPTION 'Service changed; request a fresh edit'; END IF;
     SELECT string_agg(format('%1$I=x.%1$I',key),',') INTO assignments FROM jsonb_object_keys(row_data->'changed_data') key
     WHERE key=ANY(public.review_content_fields('services')) AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='services' AND column_name=key);
     IF assignments IS NOT NULL THEN
       EXECUTE 'UPDATE public.services s SET '||assignments||',moderation_status=''approved'',moderation_revision=s.moderation_revision+1 FROM jsonb_populate_record(NULL::public.services,$1) x WHERE s.id=$2'
       USING row_data->'changed_data',service_row.id;
     END IF;
     patch:=patch||'{"status":"approved"}'::jsonb;
   ELSIF p_table='profile_public_revisions' THEN
     UPDATE public.profiles SET
       phone=CASE WHEN row_data->'changes' ? 'phone' THEN row_data->'changes'->>'phone' ELSE phone END,
       email=CASE WHEN row_data->'changes' ? 'email' THEN row_data->'changes'->>'email' ELSE email END,
       full_name=CASE WHEN row_data->'changes' ? 'full_name' THEN row_data->'changes'->>'full_name' ELSE full_name END,
       avatar_url=CASE WHEN row_data->'changes' ? 'avatar_url' THEN row_data->'changes'->>'avatar_url' ELSE avatar_url END,
       bio=CASE WHEN row_data->'changes' ? 'bio' THEN row_data->'changes'->>'bio' ELSE bio END,
       company_name=CASE WHEN row_data->'changes' ? 'company_name' THEN row_data->'changes'->>'company_name' ELSE company_name END,
       social_links=CASE WHEN row_data->'changes' ? 'social_links' THEN row_data->'changes'->'social_links' ELSE social_links END
     WHERE id=p_id::uuid;
   ELSIF p_table IN ('directory_listings','services','properties','listing_reviews') THEN patch:=patch||'{"status":"approved"}'::jsonb;
   ELSIF p_table IN ('products','product_items') THEN patch:=patch||'{"status":"active"}'::jsonb;
   ELSIF p_table='blog_posts' THEN patch:=patch||jsonb_build_object('status','published','published_at',now());
   ELSIF p_table='forum_events' THEN patch:=patch||'{"is_published":true}'::jsonb;
   END IF;
 END IF;
 EXECUTE format('UPDATE %1$s t SET (moderation_status,moderation_reason)=(SELECT x.moderation_status,x.moderation_reason FROM jsonb_populate_record(NULL::%1$s,$2) x) WHERE id::text=$1 RETURNING to_jsonb(t)',target) INTO result USING p_id,row_data||patch;
 IF patch ? 'status' THEN
   EXECUTE format('UPDATE %1$s SET status=(SELECT x.status FROM jsonb_populate_record(NULL::%1$s,$2) x) WHERE id::text=$1',target) USING p_id,row_data||patch;
 END IF;
 IF p_table='forum_events' THEN UPDATE public.forum_events SET is_published=p_approve WHERE id::text=p_id; END IF;
 IF p_approve AND p_table='blog_posts' THEN UPDATE public.blog_posts SET published_at=coalesce(published_at,now()) WHERE id::text=p_id; END IF;
 RETURN result||patch;
END $$;
REVOKE ALL ON FUNCTION public.review_public_content(text,text,bigint,boolean,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_public_content(text,text,bigint,boolean,text,uuid) TO service_role;
