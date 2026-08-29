-- Allow administrators to correct only the Vault attribution of an existing
-- supplier payment while retaining an immutable audit trail.
CREATE TABLE public.supplier_payment_vault_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_payment_id uuid NOT NULL REFERENCES public.supplier_payments(id) ON DELETE RESTRICT,
  purchase_id uuid REFERENCES public.purchases(id) ON DELETE RESTRICT,
  old_vault_user_id uuid NOT NULL REFERENCES public.vault_users(id) ON DELETE RESTRICT,
  new_vault_user_id uuid NOT NULL REFERENCES public.vault_users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  corrected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  corrected_at timestamptz NOT NULL DEFAULT now(),
  CHECK (old_vault_user_id <> new_vault_user_id)
);

CREATE INDEX supplier_payment_vault_corrections_payment_idx
  ON public.supplier_payment_vault_corrections (supplier_payment_id, corrected_at DESC);

ALTER TABLE public.supplier_payment_vault_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view Vault corrections"
  ON public.supplier_payment_vault_corrections FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.supplier_payment_vault_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.supplier_payment_vault_corrections TO authenticated;

CREATE OR REPLACE FUNCTION public.correct_supplier_payment_vault(
  p_supplier_payment_id uuid,
  p_new_vault_user_id uuid,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  payment public.supplier_payments%ROWTYPE;
  purchase_row public.purchases%ROWTYPE;
  common_vault_id uuid;
  distinct_vault_count integer;
  correction_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Correction reason is required';
  END IF;

  SELECT * INTO payment FROM public.supplier_payments
    WHERE id = p_supplier_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier payment does not exist'; END IF;
  IF payment.vault_user_id IS NULL THEN
    RAISE EXCEPTION 'Supplier payment has no existing Vault attribution';
  END IF;

  -- Lock both the related Purchase and destination Vault so neither can change
  -- validity during this transaction.
  IF payment.purchase_id IS NOT NULL THEN
    SELECT * INTO purchase_row FROM public.purchases
      WHERE id = payment.purchase_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Related Purchase does not exist'; END IF;
  END IF;
  PERFORM 1 FROM public.vault_users
    WHERE id = p_new_vault_user_id AND is_active AND vault_type = 'business_cash'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A valid active Business Cash Vault is required';
  END IF;
  IF payment.vault_user_id = p_new_vault_user_id THEN
    RAISE EXCEPTION 'New Vault must differ from the current Vault';
  END IF;

  UPDATE public.supplier_payments
    SET vault_user_id = p_new_vault_user_id
    WHERE id = payment.id;

  IF payment.purchase_id IS NOT NULL THEN
    SELECT count(DISTINCT vault_user_id), min(vault_user_id::text)::uuid
      INTO distinct_vault_count, common_vault_id
      FROM public.supplier_payments
      WHERE purchase_id = payment.purchase_id;
    -- A single payment and multiple payments from one Vault both resolve the
    -- header. A mixed-Vault Purchase deliberately retains its prior header.
    IF distinct_vault_count = 1 THEN
      UPDATE public.purchases SET vault_user_id = common_vault_id
        WHERE id = payment.purchase_id;
    END IF;
  END IF;

  INSERT INTO public.supplier_payment_vault_corrections
    (supplier_payment_id, purchase_id, old_vault_user_id, new_vault_user_id, reason, corrected_by)
  VALUES
    (payment.id, payment.purchase_id, payment.vault_user_id, p_new_vault_user_id, btrim(p_reason), auth.uid())
  RETURNING id INTO correction_id;

  RETURN correction_id;
END $$;

REVOKE ALL ON FUNCTION public.correct_supplier_payment_vault(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_supplier_payment_vault(uuid,uuid,text) TO authenticated;
