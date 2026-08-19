CREATE OR REPLACE FUNCTION public.sync_purchase_vault_to_supplier_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.vault_user_id IS DISTINCT FROM OLD.vault_user_id THEN
    UPDATE public.supplier_payments
    SET vault_user_id = NEW.vault_user_id,
        updated_at = now()
    WHERE purchase_id = NEW.id
      AND vault_user_id IS DISTINCT FROM NEW.vault_user_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_purchase_vault_to_supplier_payments ON public.purchases;

CREATE TRIGGER trg_sync_purchase_vault_to_supplier_payments
AFTER UPDATE OF vault_user_id ON public.purchases
FOR EACH ROW
EXECUTE FUNCTION public.sync_purchase_vault_to_supplier_payments();