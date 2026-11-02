-- Fix POS authorization password updates in Lovable-managed PostgreSQL.
-- PostgREST's safe-update policy rejects UPDATE statements without WHERE.
-- Keep the existing admin check and store only a bcrypt hash.
CREATE OR REPLACE FUNCTION public.set_pos_authorization_password(p_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_updated integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF length(COALESCE(p_password, '')) < 4 THEN
    RAISE EXCEPTION 'Password must be at least 4 characters';
  END IF;

  UPDATE public.app_settings
  SET pos_authorization_hash = extensions.crypt(p_password, extensions.gen_salt('bf')),
      updated_at = now()
  WHERE id IS NOT NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'Business settings are not initialized; contact an administrator';
  END IF;

  INSERT INTO public.activity_logs(user_id, action, entity_type, summary, metadata)
  VALUES(auth.uid(), 'update', 'app_settings', 'POS authorization password changed', '{}'::jsonb);
END
$function$;

REVOKE ALL ON FUNCTION public.set_pos_authorization_password(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_pos_authorization_password(text) TO authenticated;
