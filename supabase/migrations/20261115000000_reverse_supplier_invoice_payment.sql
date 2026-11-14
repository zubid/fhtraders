-- Administrative correction: remove an erroneous supplier-payment allocation without changing stock.
-- Original payment is removed from the active ledger; an immutable reversal audit remains.
CREATE TABLE IF NOT EXISTS public.supplier_payment_reversal_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_payment_id uuid NOT NULL UNIQUE,
  purchase_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  original_vault_user_id uuid,
  destination_vault_user_id uuid NOT NULL,
  amount numeric NOT NULL,
  payment_date date NOT NULL,
  method text,
  original_note text,
  original_created_at timestamptz,
  vault_corrections jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 8),
  reversed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reversed_at timestamptz NOT NULL DEFAULT now(),
  transfer_movement_id uuid REFERENCES public.vault_cash_movements(id) ON DELETE RESTRICT
);
ALTER TABLE public.supplier_payment_reversal_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin read supplier payment reversals" ON public.supplier_payment_reversal_audit;
CREATE POLICY "Admin read supplier payment reversals" ON public.supplier_payment_reversal_audit
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
REVOKE ALL ON public.supplier_payment_reversal_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.supplier_payment_reversal_audit TO authenticated;

CREATE OR REPLACE FUNCTION public.reverse_supplier_invoice_payment(
  p_supplier_payment_id uuid,
  p_destination_vault_user_id uuid,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  pay public.supplier_payments%ROWTYPE;
  bill public.purchases%ROWTYPE;
  source_vault uuid;
  destination public.vault_users%ROWTYPE;
  linked_before numeric;
  remaining_vaults integer;
  remaining_vault uuid;
  audit_id uuid;
  movement_id uuid;
  corrections jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF length(btrim(coalesce(p_reason,''))) < 8 THEN
    RAISE EXCEPTION 'Provide a correction reason (at least 8 characters)';
  END IF;
  SELECT * INTO pay FROM public.supplier_payments WHERE id=p_supplier_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier payment does not exist or was already reversed'; END IF;
  IF pay.purchase_id IS NULL THEN
    RAISE EXCEPTION 'This payment has no invoice link; use supplier-level reconciliation';
  END IF;
  SELECT * INTO bill FROM public.purchases WHERE id=pay.purchase_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Related purchase does not exist'; END IF;
  IF pay.supplier_id IS DISTINCT FROM bill.supplier_id THEN
    RAISE EXCEPTION 'Payment and purchase supplier mismatch';
  END IF;
  SELECT * INTO destination FROM public.vault_users WHERE id=p_destination_vault_user_id FOR UPDATE;
  IF NOT FOUND OR NOT destination.is_active OR destination.vault_type<>'business_cash' THEN
    RAISE EXCEPTION 'Select an active Business Cash Vault';
  END IF;
  source_vault := coalesce(pay.vault_user_id,bill.vault_user_id);
  IF source_vault IS NULL THEN
    RAISE EXCEPTION 'Original payment has no vault attribution; reconcile before reversing';
  END IF;
  SELECT coalesce(sum(amount),0) INTO linked_before
    FROM public.supplier_payments WHERE purchase_id=bill.id;
  IF linked_before > bill.amount_paid + 0.01 OR bill.amount_paid < pay.amount - 0.01 THEN
    RAISE EXCEPTION 'Invoice payment history is inconsistent; manual reconciliation required';
  END IF;
  -- The legacy vault calculation uses the purchase header for single-vault bills.
  -- Do not silently reassign a mismatched historical header.
  IF bill.vault_user_id IS DISTINCT FROM source_vault AND
    (SELECT count(DISTINCT vault_user_id) FROM public.supplier_payments
     WHERE purchase_id=bill.id AND vault_user_id IS NOT NULL) <= 1 THEN
    RAISE EXCEPTION 'Purchase header vault differs from payment vault; reconcile before reversing';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO corrections
    FROM public.supplier_payment_vault_corrections c WHERE c.supplier_payment_id=pay.id;

  -- Remove correction child records first; the full history is archived above.
  DELETE FROM public.supplier_payment_vault_corrections WHERE supplier_payment_id=pay.id;
  DELETE FROM public.supplier_payments WHERE id=pay.id;
  SELECT count(DISTINCT vault_user_id), min(vault_user_id::text)::uuid
    INTO remaining_vaults, remaining_vault
    FROM public.supplier_payments WHERE purchase_id=bill.id AND vault_user_id IS NOT NULL;
  UPDATE public.purchases SET
    amount_paid=greatest(0,amount_paid-pay.amount),
    vault_user_id=CASE WHEN amount_paid-pay.amount <= 0.001 THEN NULL
                       WHEN remaining_vaults=1 THEN remaining_vault
                       ELSE vault_user_id END
    WHERE id=bill.id;

  -- Reversing the payment credits its original vault through the reduced purchase
  -- spend. A different requested destination is a separately visible transfer.
  IF source_vault <> p_destination_vault_user_id THEN
    INSERT INTO public.vault_cash_movements
      (movement_type,source_vault_user_id,destination_vault_user_id,
       amount,movement_date,note,created_by)
    VALUES ('internal_transfer',source_vault,p_destination_vault_user_id,
      pay.amount,CURRENT_DATE,
      'Invoice payment reversal '||bill.reference_no||' / '||pay.id::text||
      ': '||btrim(p_reason),auth.uid())
    RETURNING id INTO movement_id;
  END IF;
  INSERT INTO public.supplier_payment_reversal_audit
    (original_payment_id,purchase_id,supplier_id,original_vault_user_id,
     destination_vault_user_id,amount,payment_date,method,original_note,
     original_created_at,vault_corrections,reason,reversed_by,transfer_movement_id)
  VALUES (pay.id,bill.id,pay.supplier_id,source_vault,p_destination_vault_user_id,
    pay.amount,pay.payment_date,pay.method,pay.note,pay.created_at,corrections,
    btrim(p_reason),auth.uid(),movement_id)
  RETURNING id INTO audit_id;
  RETURN audit_id;
END $$;
REVOKE ALL ON FUNCTION public.reverse_supplier_invoice_payment(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_supplier_invoice_payment(uuid,uuid,text)
  TO authenticated;
