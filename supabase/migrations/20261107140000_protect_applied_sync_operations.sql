-- Preserve successful financial sync idempotency keys even when their target row is missing.
-- Several legacy sync receivers delete an existing operation before retrying if
-- the referenced cloud transaction cannot be found. Reusing that operation ID
-- could otherwise post a second financial transaction.
CREATE OR REPLACE FUNCTION public.prevent_applied_sync_operation_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'applied' THEN
    RAISE EXCEPTION 'Applied sync operation % cannot be deleted; manual reconciliation required', OLD.operation_id
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS protect_applied_sync_operation_delete ON public.sync_operations;
CREATE TRIGGER protect_applied_sync_operation_delete
BEFORE DELETE ON public.sync_operations
FOR EACH ROW
EXECUTE FUNCTION public.prevent_applied_sync_operation_delete();
