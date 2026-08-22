-- Auditable transfers between business cash holders and owner distribution wallets.
ALTER TABLE public.vault_users
  ADD COLUMN IF NOT EXISTS vault_type text NOT NULL DEFAULT 'business_cash';

DO $$ BEGIN
  ALTER TABLE public.vault_users ADD CONSTRAINT vault_users_vault_type_check
    CHECK (vault_type IN ('business_cash', 'owner_cash'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Names are production data, unlike deployment-specific UUIDs. Opening balances are untouched.
UPDATE public.vault_users SET vault_type = 'owner_cash'
WHERE lower(btrim(name)) IN ('abd cash', 'imii cash') AND vault_type <> 'owner_cash';

DO $$ BEGIN
  ALTER TABLE public.vault_users ADD CONSTRAINT vault_users_owner_cash_zero_opening_check
    CHECK (vault_type <> 'owner_cash' OR opening_balance = 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.vault_cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_type text NOT NULL CHECK (movement_type IN ('internal_transfer', 'owner_distribution')),
  source_vault_user_id uuid NOT NULL REFERENCES public.vault_users(id) ON DELETE RESTRICT,
  destination_vault_user_id uuid NOT NULL REFERENCES public.vault_users(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  movement_date date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  CONSTRAINT vault_cash_movements_distinct_vaults CHECK (source_vault_user_id <> destination_vault_user_id)
);
CREATE INDEX IF NOT EXISTS idx_vcm_source ON public.vault_cash_movements(source_vault_user_id);
CREATE INDEX IF NOT EXISTS idx_vcm_destination ON public.vault_cash_movements(destination_vault_user_id);
CREATE INDEX IF NOT EXISTS idx_vcm_date ON public.vault_cash_movements(movement_date);
CREATE INDEX IF NOT EXISTS idx_vcm_type ON public.vault_cash_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_vcm_active_source ON public.vault_cash_movements(source_vault_user_id) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vcm_active_destination ON public.vault_cash_movements(destination_vault_user_id) WHERE voided_at IS NULL;

DROP TRIGGER IF EXISTS update_vault_cash_movements_updated_at ON public.vault_cash_movements;
CREATE TRIGGER update_vault_cash_movements_updated_at BEFORE UPDATE ON public.vault_cash_movements
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Matches the existing UI formula, including only genuine multi-vault purchase splits.
CREATE OR REPLACE FUNCTION public.vault_available_balance(p_vault_user_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH split_purchases AS (
    SELECT purchase_id FROM public.supplier_payments
    WHERE purchase_id IS NOT NULL AND vault_user_id IS NOT NULL
    GROUP BY purchase_id HAVING count(DISTINCT vault_user_id) > 1
  )
  SELECT COALESCE(v.opening_balance, 0)
    + COALESCE((SELECT sum(t.amount) FROM public.vault_topups t WHERE t.vault_user_id=v.id),0)
    + COALESCE((SELECT sum(r.amount) FROM public.payments r WHERE r.vault_user_id=v.id),0)
    - COALESCE((SELECT sum(p.amount_paid) FROM public.purchases p WHERE p.vault_user_id=v.id AND NOT EXISTS (SELECT 1 FROM split_purchases s WHERE s.purchase_id=p.id)),0)
    - COALESCE((SELECT sum(sp.amount) FROM public.supplier_payments sp WHERE sp.vault_user_id=v.id AND EXISTS (SELECT 1 FROM split_purchases s WHERE s.purchase_id=sp.purchase_id)),0)
    - COALESCE((SELECT sum(e.amount) FROM public.expenses e WHERE e.vault_user_id=v.id),0)
    + COALESCE((SELECT sum(m.amount) FROM public.vault_cash_movements m WHERE m.destination_vault_user_id=v.id AND m.voided_at IS NULL),0)
    - COALESCE((SELECT sum(m.amount) FROM public.vault_cash_movements m WHERE m.source_vault_user_id=v.id AND m.voided_at IS NULL),0)
  FROM public.vault_users v WHERE v.id=p_vault_user_id;
$$;

CREATE OR REPLACE FUNCTION public.prevent_nonzero_vault_deactivation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.is_active AND NOT NEW.is_active
     AND abs(public.vault_available_balance(OLD.id)) > 0.005 THEN
    RAISE EXCEPTION 'Transfer or distribute the remaining balance before deactivating this Vault.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS prevent_nonzero_vault_deactivation ON public.vault_users;
CREATE TRIGGER prevent_nonzero_vault_deactivation
BEFORE UPDATE OF is_active ON public.vault_users
FOR EACH ROW EXECUTE FUNCTION public.prevent_nonzero_vault_deactivation();

CREATE OR REPLACE FUNCTION public.record_vault_cash_movement(
  p_movement_type text, p_source_vault_user_id uuid, p_destination_vault_user_id uuid,
  p_amount numeric, p_movement_date date DEFAULT CURRENT_DATE, p_note text DEFAULT NULL
) RETURNS public.vault_cash_movements LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE src public.vault_users; dst public.vault_users; result public.vault_cash_movements; available numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than zero'; END IF;
  IF COALESCE(p_movement_date, CURRENT_DATE) > CURRENT_DATE THEN RAISE EXCEPTION 'Cash movements cannot be future dated'; END IF;
  IF p_source_vault_user_id = p_destination_vault_user_id THEN RAISE EXCEPTION 'Source and destination must differ'; END IF;
  SELECT * INTO src FROM public.vault_users WHERE id=p_source_vault_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source Vault does not exist'; END IF;
  SELECT * INTO dst FROM public.vault_users WHERE id=p_destination_vault_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Destination Vault does not exist'; END IF;
  IF NOT src.is_active OR NOT dst.is_active THEN RAISE EXCEPTION 'Source and destination Vaults must be active'; END IF;
  IF p_movement_type='internal_transfer' THEN
    IF src.vault_type<>'business_cash' OR dst.vault_type<>'business_cash' THEN RAISE EXCEPTION 'Internal transfers require two Business Cash Vaults'; END IF;
  ELSIF p_movement_type='owner_distribution' THEN
    IF src.vault_type<>'business_cash' OR dst.vault_type<>'owner_cash' THEN RAISE EXCEPTION 'Owner distributions require Business Cash to Owner Cash'; END IF;
  ELSE RAISE EXCEPTION 'Invalid movement type'; END IF;
  available := public.vault_available_balance(src.id);
  IF available < p_amount THEN RAISE EXCEPTION 'Insufficient source balance (available: %)', available; END IF;
  INSERT INTO public.vault_cash_movements(movement_type,source_vault_user_id,destination_vault_user_id,amount,movement_date,note,created_by)
  VALUES(p_movement_type,src.id,dst.id,p_amount,COALESCE(p_movement_date,CURRENT_DATE),NULLIF(btrim(p_note),''),auth.uid()) RETURNING * INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.void_vault_cash_movement(p_movement_id uuid, p_reason text)
RETURNS public.vault_cash_movements LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.vault_cash_movements; destination_balance numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Void reason is required'; END IF;
  SELECT * INTO result FROM public.vault_cash_movements WHERE id=p_movement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cash movement does not exist'; END IF;
  IF result.voided_at IS NOT NULL THEN RAISE EXCEPTION 'Cash movement is already voided'; END IF;
  -- Serialize against both movement creation and another void, then ensure removing
  -- the original inflow cannot manufacture a negative destination balance.
  PERFORM 1 FROM public.vault_users WHERE id=result.destination_vault_user_id FOR UPDATE;
  destination_balance := public.vault_available_balance(result.destination_vault_user_id);
  IF destination_balance < result.amount THEN
    IF result.movement_type = 'internal_transfer' THEN
      RAISE EXCEPTION 'This transfer cannot be voided because the destination Vault no longer has sufficient available cash. Record a compensating transfer instead.';
    ELSE
      RAISE EXCEPTION 'This distribution cannot be voided because the owner wallet no longer has sufficient available cash.';
    END IF;
  END IF;
  UPDATE public.vault_cash_movements SET voided_at=now(),voided_by=auth.uid(),void_reason=btrim(p_reason)
  WHERE id=p_movement_id RETURNING * INTO result;
  RETURN result;
END $$;

ALTER TABLE public.vault_cash_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth read vault_cash_movements" ON public.vault_cash_movements;
CREATE POLICY "Auth read vault_cash_movements" ON public.vault_cash_movements FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admin insert vault_cash_movements" ON public.vault_cash_movements;
DROP POLICY IF EXISTS "Admin update vault_cash_movements" ON public.vault_cash_movements;

DROP POLICY IF EXISTS "Auth manage vault_users" ON public.vault_users;
DROP POLICY IF EXISTS "Admin manage vault_users" ON public.vault_users;
CREATE POLICY "Admin manage vault_users" ON public.vault_users FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "Auth manage vault_topups" ON public.vault_topups;
DROP POLICY IF EXISTS "Admin manage vault_topups" ON public.vault_topups;
CREATE POLICY "Admin manage vault_topups" ON public.vault_topups FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin'))
WITH CHECK (public.has_role(auth.uid(),'admin') AND EXISTS (SELECT 1 FROM public.vault_users v WHERE v.id=vault_user_id AND v.vault_type='business_cash'));

REVOKE ALL ON public.vault_cash_movements FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.vault_users, public.vault_topups FROM authenticated;
GRANT SELECT ON public.vault_users, public.vault_topups, public.vault_cash_movements TO authenticated;
GRANT INSERT, UPDATE ON public.vault_users, public.vault_topups TO authenticated;
GRANT EXECUTE ON FUNCTION public.vault_available_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_vault_cash_movement(text,uuid,uuid,numeric,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_vault_cash_movement(uuid,text) TO authenticated;
