-- Preserve supplier payment history and make all Pay Supplier allocations atomic.
DROP TRIGGER IF EXISTS trg_sync_purchase_vault_to_supplier_payments ON public.purchases;
DROP FUNCTION IF EXISTS public.sync_purchase_vault_to_supplier_payments();

CREATE OR REPLACE FUNCTION public.prevent_paid_purchase_supplier_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
     AND EXISTS (SELECT 1 FROM public.supplier_payments WHERE purchase_id = OLD.id) THEN
    RAISE EXCEPTION 'Supplier cannot be changed after payments have been recorded.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS prevent_paid_purchase_supplier_change ON public.purchases;
CREATE TRIGGER prevent_paid_purchase_supplier_change
BEFORE UPDATE OF supplier_id ON public.purchases
FOR EACH ROW EXECUTE FUNCTION public.prevent_paid_purchase_supplier_change();

CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  p_supplier_id uuid,
  p_amount numeric,
  p_method text,
  p_payment_date date,
  p_note text DEFAULT NULL,
  p_preferred_purchase_id uuid DEFAULT NULL,
  p_vault_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target public.purchases%ROWTYPE;
  linked_total numeric;
  allocation numeric;
  remaining numeric := p_amount;
  total_outstanding numeric;
  allocation_count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required';
  END IF;
  IF p_payment_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Supplier payments cannot be future dated';
  END IF;
  IF NULLIF(btrim(p_method), '') IS NULL THEN
    RAISE EXCEPTION 'Payment method is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id) THEN
    RAISE EXCEPTION 'Supplier does not exist';
  END IF;
  -- Lock the Vault so its validity cannot change during this transaction.
  PERFORM 1 FROM public.vault_users
    WHERE id = p_vault_user_id AND is_active AND vault_type = 'business_cash'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A valid active Business Cash Vault is required';
  END IF;

  IF p_preferred_purchase_id IS NOT NULL THEN
    SELECT * INTO target FROM public.purchases
      WHERE id = p_preferred_purchase_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Purchase does not exist'; END IF;
    IF target.supplier_id IS DISTINCT FROM p_supplier_id THEN
      RAISE EXCEPTION 'Purchase does not belong to the selected Supplier';
    END IF;

    SELECT COALESCE(sum(amount), 0) INTO linked_total
      FROM public.supplier_payments WHERE purchase_id = target.id;
    IF linked_total > target.amount_paid + 0.01 THEN
      RAISE EXCEPTION 'This Purchase has inconsistent linked payment history and must be reconciled before another payment can be recorded.';
    END IF;
    IF target.vault_user_id IS NOT NULL
       AND target.vault_user_id <> p_vault_user_id
       AND linked_total < target.amount_paid - 0.01 THEN
      RAISE EXCEPTION 'This Purchase has incomplete historical Vault attribution and must be reconciled before a multi-Vault payment can be recorded.';
    END IF;
    allocation := GREATEST(target.grand_total - target.amount_paid, 0);
    IF p_amount > allocation + 0.001 THEN
      RAISE EXCEPTION 'Payment exceeds this Purchase''s balance due';
    END IF;
    IF allocation <= 0 THEN RAISE EXCEPTION 'Purchase is fully paid'; END IF;

    INSERT INTO public.supplier_payments
      (supplier_id, purchase_id, amount, method, payment_date, note, created_by, vault_user_id)
    VALUES
      (p_supplier_id, target.id, p_amount, btrim(p_method), p_payment_date,
       NULLIF(btrim(p_note), ''), auth.uid(), p_vault_user_id);
    UPDATE public.purchases SET
      amount_paid = amount_paid + p_amount,
      vault_user_id = CASE
        WHEN amount_paid = 0 AND vault_user_id IS NULL THEN p_vault_user_id
        ELSE vault_user_id
      END
    WHERE id = target.id;
    allocation_count := 1;
    remaining := 0;
  ELSE
    -- Lock every candidate in FIFO order before validating the supplier total.
    PERFORM 1 FROM public.purchases
      WHERE supplier_id = p_supplier_id AND grand_total > amount_paid
      ORDER BY purchase_date, created_at, id FOR UPDATE;
    SELECT COALESCE(sum(GREATEST(grand_total - amount_paid, 0)), 0)
      INTO total_outstanding FROM public.purchases WHERE supplier_id = p_supplier_id;
    IF p_amount > total_outstanding + 0.001 THEN
      RAISE EXCEPTION 'Payment exceeds the Supplier''s total outstanding balance';
    END IF;

    FOR target IN
      SELECT * FROM public.purchases
      WHERE supplier_id = p_supplier_id AND grand_total > amount_paid
      ORDER BY purchase_date, created_at, id
    LOOP
      EXIT WHEN remaining <= 0.001;
      SELECT COALESCE(sum(amount), 0) INTO linked_total
        FROM public.supplier_payments WHERE purchase_id = target.id;
      IF linked_total > target.amount_paid + 0.01 THEN
        RAISE EXCEPTION 'This Purchase has inconsistent linked payment history and must be reconciled before another payment can be recorded.';
      END IF;
      IF target.vault_user_id IS NOT NULL
         AND target.vault_user_id <> p_vault_user_id
         AND linked_total < target.amount_paid - 0.01 THEN
        RAISE EXCEPTION 'This Purchase has incomplete historical Vault attribution and must be reconciled before a multi-Vault payment can be recorded.';
      END IF;
      allocation := LEAST(remaining, target.grand_total - target.amount_paid);
      INSERT INTO public.supplier_payments
        (supplier_id, purchase_id, amount, method, payment_date, note, created_by, vault_user_id)
      VALUES
        (p_supplier_id, target.id, allocation, btrim(p_method), p_payment_date,
         NULLIF(btrim(p_note), ''), auth.uid(), p_vault_user_id);
      UPDATE public.purchases SET
        amount_paid = amount_paid + allocation,
        vault_user_id = CASE
          WHEN amount_paid = 0 AND vault_user_id IS NULL THEN p_vault_user_id
          ELSE vault_user_id
        END
      WHERE id = target.id;
      remaining := remaining - allocation;
      allocation_count := allocation_count + 1;
    END LOOP;
    IF remaining > 0.001 THEN
      RAISE EXCEPTION 'Payment could not be fully allocated';
    END IF;
  END IF;

  RETURN jsonb_build_object('amount', p_amount, 'allocation_count', allocation_count);
END $$;

REVOKE ALL ON FUNCTION public.record_supplier_payment(uuid,numeric,text,date,text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment(uuid,numeric,text,date,text,uuid,uuid) TO authenticated;

-- Ledger writes are only allowed through audited database code such as the
-- SECURITY DEFINER RPC above. History remains readable to authenticated users.
REVOKE INSERT, UPDATE, DELETE ON public.supplier_payments FROM anon, authenticated;
GRANT SELECT ON public.supplier_payments TO authenticated;
