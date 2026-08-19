CREATE OR REPLACE FUNCTION public.sync_purchase_vault_to_supplier_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.vault_user_id IS DISTINCT FROM OLD.vault_user_id
     OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
     OR NEW.purchase_date IS DISTINCT FROM OLD.purchase_date THEN
    UPDATE public.supplier_payments
    SET vault_user_id = NEW.vault_user_id,
        supplier_id = COALESCE(NEW.supplier_id, supplier_id),
        payment_date = NEW.purchase_date,
        updated_at = now()
    WHERE purchase_id = NEW.id
      AND (
        vault_user_id IS DISTINCT FROM NEW.vault_user_id
        OR (NEW.supplier_id IS NOT NULL AND supplier_id IS DISTINCT FROM NEW.supplier_id)
        OR payment_date IS DISTINCT FROM NEW.purchase_date
      );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_purchase_vault_to_supplier_payments ON public.purchases;

CREATE TRIGGER trg_sync_purchase_vault_to_supplier_payments
AFTER UPDATE OF vault_user_id, supplier_id, purchase_date ON public.purchases
FOR EACH ROW
EXECUTE FUNCTION public.sync_purchase_vault_to_supplier_payments();

REVOKE ALL ON FUNCTION public.sync_purchase_vault_to_supplier_payments() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_purchase_vault_to_supplier_payments() FROM anon;
REVOKE ALL ON FUNCTION public.sync_purchase_vault_to_supplier_payments() FROM authenticated;