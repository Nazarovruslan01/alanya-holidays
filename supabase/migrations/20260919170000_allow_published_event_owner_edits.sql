-- Merchants may edit normal fields on their own published events. Keep the
-- existing media transaction and grants, changing only its ownership guard.
DO $body$
DECLARE
  v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_definition
  FROM pg_proc
  WHERE oid = 'public.update_forum_event_with_media(UUID, UUID, JSONB, BOOLEAN, UUID, BOOLEAN, UUID)'::regprocedure;
  IF v_definition IS NULL
     OR v_definition !~* 'v_event\.is_published\s+OR'
     OR v_definition !~* 'COALESCE\(\(p_updates\s*->>\s*''is_published''\)::boolean,\s*false\)'
  THEN
    RAISE EXCEPTION 'event update RPC definition changed; forward migration refused to guess';
  END IF;
  v_definition := regexp_replace(v_definition, 'v_event\.is_published\s+OR', 'FALSE OR', 1, 1, 'i');
  v_definition := regexp_replace(
    v_definition,
    $old$IF NOT v_is_admin AND COALESCE\(\(p_updates\s*->>\s*'is_published'\)::boolean,\s*false\) THEN$old$,
    $new$IF NOT v_is_admin AND p_updates ?| ARRAY['host_id', 'created_by', 'is_published', 'attendee_count', 'created_at', 'updated_at', 'slug'] THEN$new$,
    1, 1, 'i'
  );
  IF v_definition ~* 'v_event\.is_published\s+OR'
     OR v_definition !~* 'p_updates\s*\?\|\s*ARRAY\[''host_id'',\s*''created_by'',\s*''is_published'''
  THEN
    RAISE EXCEPTION 'event update RPC guard replacement did not apply';
  END IF;
  EXECUTE v_definition;
END;
$body$;

REVOKE ALL ON FUNCTION public.update_forum_event_with_media(UUID, UUID, JSONB, BOOLEAN, UUID, BOOLEAN, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_forum_event_with_media(UUID, UUID, JSONB, BOOLEAN, UUID, BOOLEAN, UUID)
  TO service_role;
