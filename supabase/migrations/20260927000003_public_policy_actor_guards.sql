-- Keep the existing anonymous EXECUTE revoke. PostgreSQL checks expression
-- function privileges even behind CASE, so anonymous SELECT policies must not
-- reference is_admin at all. Its result for a NULL actor is always false.
-- Authenticated predicates remain unchanged; anonymous predicates substitute
-- only that false result, preserving every existing public/ownership condition.
DO $$
DECLARE p record; predicate text;
BEGIN
 FOR p IN SELECT tablename,policyname,qual,permissive,roles FROM pg_policies
   WHERE schemaname='public' AND cmd='SELECT'
     AND (tablename IN ('profiles','directory_listings') OR policyname IN ('content_review_visibility','reviewed_parent'))
     AND qual LIKE '%is_admin()%'
     AND ('public'=ANY(roles) OR 'anon'=ANY(roles))
 LOOP
   predicate:=replace(replace(p.qual,'public.is_admin()','false'),'is_admin()','false');
   EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated,service_role',p.policyname,p.tablename);
   EXECUTE format('CREATE POLICY %I ON public.%I AS %s FOR SELECT TO anon USING (%s)',p.policyname||'_anonymous',p.tablename,p.permissive,predicate);
 END LOOP;
END $$;
