\set ON_ERROR_STOP on
-- Disposable test database only, immediately before the moderation migration.
INSERT INTO public.forum_posts(id,title,slug,body,is_removed) VALUES
 ('92600000-0000-4000-8000-000000000001','Existing public discussion','legacy-moderation-live','Legacy public body',false),
 ('92600000-0000-4000-8000-000000000002','Removed discussion','legacy-moderation-removed','Removed body',true);
INSERT INTO public.services(id,title,service_type,status) VALUES
 ('92600000-0000-4000-8000-000000000003','Existing published service','car','approved'),
 ('92600000-0000-4000-8000-000000000004','Existing draft service','car','draft');
-- Metadata-only compatibility overlay. No production rows or credentials.
ALTER TABLE public.products DROP COLUMN IF EXISTS status;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK(role IN ('guest','host','admin')) NOT VALID;
ALTER TABLE public.service_edits ADD CONSTRAINT service_edits_status_check CHECK(status IN ('pending','rejected')) NOT VALID;
-- Existing production JSON payload column omitted by the lightweight fixture.
ALTER TABLE public.service_edits ADD COLUMN IF NOT EXISTS changed_data jsonb NOT NULL DEFAULT '{}';
-- NOT VALID retains the synthetic legacy draft above while exercising both
-- catalog constraint names; the production catalog has these same expressions.
ALTER TABLE public.services ADD CONSTRAINT check_service_status CHECK(status IN ('approved','pending','rejected')) NOT VALID;
ALTER TABLE public.services ADD CONSTRAINT services_status_check CHECK(status IN ('approved','pending','rejected')) NOT VALID;
