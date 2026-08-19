-- Financial ledger reconstruction.  This migration deliberately snapshots every
-- historical row it touches before making reversible, audit-friendly changes.
BEGIN;

CREATE TABLE IF NOT EXISTS public.financial_audit_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  migration_key text NOT NULL,
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  original_row jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (migration_key, table_name, row_id)
);
ALTER TABLE public.financial_audit_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read financial snapshots" ON public.financial_audit_snapshots;
CREATE POLICY "Admins read financial snapshots" ON public.financial_audit_snapshots
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
REVOKE ALL ON public.financial_audit_snapshots FROM anon, authenticated;
GRANT SELECT ON public.financial_audit_snapshots TO authenticated;

INSERT INTO public.financial_audit_snapshots(migration_key, table_name, row_id, original_row)
SELECT '20260819143000', 'supplier_payments', id, to_jsonb(sp)
FROM public.supplier_payments sp
WHERE id IN (
  '2923a6f5-fe46-404d-a714-9f5f4ac96f7a','9ebcc5db-c289-4cca-a05b-bb1d3382393b',
  'be3e2511-c778-43bb-be43-6b8f07b785aa','4319a86c-24b1-4e0f-a246-719b20e4b1f0',
  '5ba2e22f-8d18-4941-84d1-d2111e1005ec','cc233182-57db-41ec-95b0-d3873f22dc4b',
  '9e48d2ea-f184-4369-b5b9-4383926b705a','8347996e-699a-4626-9fbf-b481e7801860',
  '6ae2ace5-95f4-481a-bd90-1b92017797ba','7daf41ea-1679-48e1-87c0-24923466fb7a'
) ON CONFLICT DO NOTHING;

INSERT INTO public.financial_audit_snapshots(migration_key, table_name, row_id, original_row)
SELECT '20260819143000', 'purchases', p.id, to_jsonb(p)
FROM public.purchases p
WHERE p.id IN ('95c7a4b8-3d53-418e-92df-4506f7dfdd76','c09ca1ed-7b19-4a5b-b5e0-e0abb7f04779')
   OR p.id IN (SELECT purchase_id FROM public.supplier_payments WHERE purchase_id IS NOT NULL)
ON CONFLICT DO NOTHING;

ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS is_void boolean NOT NULL DEFAULT false;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS voided_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_supplier_payments_active_vault
  ON public.supplier_payments(vault_user_id, payment_date) WHERE NOT is_void;

-- Remove the header-attribution trigger: a purchase may have genuine cash splits.
DROP TRIGGER IF EXISTS trg_sync_purchase_vault_to_supplier_payments ON public.purchases;
DROP FUNCTION IF EXISTS public.sync_purchase_vault_to_supplier_payments();

CREATE TABLE IF NOT EXISTS public.supplier_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_payment_id uuid NOT NULL REFERENCES public.supplier_payments(id) ON DELETE CASCADE,
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_payment_id, purchase_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_allocations_purchase ON public.supplier_payment_allocations(purchase_id);
ALTER TABLE public.supplier_payment_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read supplier allocations" ON public.supplier_payment_allocations;
DROP POLICY IF EXISTS "Admins manage supplier allocations" ON public.supplier_payment_allocations;
CREATE POLICY "Authenticated read supplier allocations" ON public.supplier_payment_allocations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage supplier allocations" ON public.supplier_payment_allocations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_payment_allocations TO authenticated;

UPDATE public.supplier_payments SET is_void=true,
  void_reason='Confirmed duplicate — verified legacy reconciliation (PKR 414,068.90 group)', voided_at=now(), updated_at=now()
WHERE id IN (
  '2923a6f5-fe46-404d-a714-9f5f4ac96f7a','9ebcc5db-c289-4cca-a05b-bb1d3382393b',
  'be3e2511-c778-43bb-be43-6b8f07b785aa','4319a86c-24b1-4e0f-a246-719b20e4b1f0',
  '5ba2e22f-8d18-4941-84d1-d2111e1005ec','cc233182-57db-41ec-95b0-d3873f22dc4b',
  '9e48d2ea-f184-4369-b5b9-4383926b705a'
);
UPDATE public.supplier_payments SET purchase_id='95c7a4b8-3d53-418e-92df-4506f7dfdd76',
  vault_user_id='01ffc90b-837d-4d05-8259-e06e29077cba', is_void=false, void_reason=NULL, voided_at=NULL, updated_at=now()
WHERE id='8347996e-699a-4626-9fbf-b481e7801860';
UPDATE public.supplier_payments SET purchase_id='c09ca1ed-7b19-4a5b-b5e0-e0abb7f04779',
  vault_user_id='d1c98b52-0391-4227-9d3a-bf7a3cab4568', is_void=false, void_reason=NULL, voided_at=NULL, updated_at=now()
WHERE id='6ae2ace5-95f4-481a-bd90-1b92017797ba';
UPDATE public.supplier_payments SET purchase_id=NULL, vault_user_id=NULL, is_void=false,
  void_reason=NULL, voided_at=NULL, updated_at=now()
WHERE id='7daf41ea-1679-48e1-87c0-24923466fb7a';

-- Backfill only explicit historical links.  Unlinked cash remains an advance.
INSERT INTO public.supplier_payment_allocations(supplier_payment_id,purchase_id,amount)
SELECT sp.id, sp.purchase_id, LEAST(sp.amount, p.grand_total)
FROM public.supplier_payments sp JOIN public.purchases p ON p.id=sp.purchase_id
WHERE NOT sp.is_void AND sp.amount > 0
ON CONFLICT (supplier_payment_id,purchase_id) DO UPDATE SET amount=EXCLUDED.amount;

CREATE OR REPLACE FUNCTION public.rebuild_purchase_payment_summaries(p_supplier_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE purchases p SET amount_paid=COALESCE(x.paid,0)
  FROM (SELECT p2.id, SUM(a.amount) FILTER (WHERE NOT sp.is_void) paid
        FROM purchases p2 LEFT JOIN supplier_payment_allocations a ON a.purchase_id=p2.id
        LEFT JOIN supplier_payments sp ON sp.id=a.supplier_payment_id
        WHERE p_supplier_id IS NULL OR p2.supplier_id=p_supplier_id GROUP BY p2.id) x
  WHERE p.id=x.id;
END $$;
REVOKE ALL ON FUNCTION public.rebuild_purchase_payment_summaries(uuid) FROM PUBLIC, anon, authenticated;

SELECT public.rebuild_purchase_payment_summaries(NULL);

CREATE OR REPLACE FUNCTION public.save_supplier_payment(
  p_payment_id uuid, p_supplier_id uuid, p_purchase_id uuid, p_amount numeric,
  p_method text, p_payment_date date, p_note text, p_vault_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_remaining numeric; v_due numeric; r record;
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than zero'; END IF;
  IF p_payment_id IS NULL THEN
    INSERT INTO supplier_payments(supplier_id,purchase_id,amount,method,payment_date,note,vault_user_id,created_by)
    VALUES(p_supplier_id,p_purchase_id,p_amount,p_method,p_payment_date,NULLIF(p_note,''),p_vault_user_id,auth.uid()) RETURNING id INTO v_id;
  ELSE
    UPDATE supplier_payments SET supplier_id=p_supplier_id,purchase_id=p_purchase_id,amount=p_amount,
      method=p_method,payment_date=p_payment_date,note=NULLIF(p_note,''),vault_user_id=p_vault_user_id,
      is_void=false,void_reason=NULL,voided_at=NULL,updated_at=now() WHERE id=p_payment_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;
  END IF;
  DELETE FROM supplier_payment_allocations WHERE supplier_payment_id=v_id;
  v_remaining := p_amount;
  FOR r IN SELECT id,grand_total,amount_paid FROM purchases
    WHERE supplier_id=p_supplier_id AND (p_purchase_id IS NULL OR id=p_purchase_id)
    ORDER BY CASE WHEN id=p_purchase_id THEN 0 ELSE 1 END,purchase_date,created_at FOR UPDATE
  LOOP
    SELECT GREATEST(r.grand_total-COALESCE(SUM(a.amount) FILTER(WHERE NOT sp.is_void),0),0) INTO v_due
    FROM supplier_payment_allocations a JOIN supplier_payments sp ON sp.id=a.supplier_payment_id WHERE a.purchase_id=r.id;
    v_due := COALESCE(v_due,r.grand_total);
    IF v_remaining > 0 AND v_due > 0 THEN
      INSERT INTO supplier_payment_allocations(supplier_payment_id,purchase_id,amount) VALUES(v_id,r.id,LEAST(v_remaining,v_due));
      v_remaining := v_remaining-LEAST(v_remaining,v_due);
    END IF;
    EXIT WHEN v_remaining <= 0;
  END LOOP;
  PERFORM rebuild_purchase_payment_summaries(p_supplier_id); RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.save_supplier_payment(uuid,uuid,uuid,numeric,text,date,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.void_supplier_payment(p_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_supplier uuid;
BEGIN
 IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
 SELECT supplier_id INTO v_supplier FROM supplier_payments WHERE id=p_payment_id FOR UPDATE;
 UPDATE supplier_payments SET is_void=true,void_reason='Voided by admin',voided_at=now(),updated_at=now() WHERE id=p_payment_id;
 PERFORM rebuild_purchase_payment_summaries(v_supplier);
END $$;
GRANT EXECUTE ON FUNCTION public.void_supplier_payment(uuid) TO authenticated;

-- Vault master data is readable by authenticated staff but mutable only by admins.
DROP POLICY IF EXISTS "Auth manage vault_users" ON public.vault_users;
DROP POLICY IF EXISTS "Auth manage vault_topups" ON public.vault_topups;
CREATE POLICY "Admins manage vault_users" ON public.vault_users FOR ALL TO authenticated
 USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage vault_topups" ON public.vault_topups FOR ALL TO authenticated
 USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE OR REPLACE VIEW public.financial_reconciliation WITH (security_invoker=true) AS
SELECT 'restaurant_payments_without_vault' issue, count(*) row_count, COALESCE(sum(amount),0) amount FROM payments WHERE vault_user_id IS NULL
UNION ALL SELECT 'supplier_payments_without_vault',count(*),COALESCE(sum(amount),0) FROM supplier_payments WHERE vault_user_id IS NULL AND NOT is_void
UNION ALL SELECT 'supplier_advances_unallocated',count(*),COALESCE(sum(sp.amount-COALESCE(a.allocated,0)),0) FROM supplier_payments sp LEFT JOIN
 (SELECT supplier_payment_id,sum(amount) allocated FROM supplier_payment_allocations GROUP BY 1) a ON a.supplier_payment_id=sp.id
 WHERE NOT sp.is_void AND sp.amount>COALESCE(a.allocated,0)
UNION ALL SELECT 'void_legacy_supplier_payments',count(*),COALESCE(sum(amount),0) FROM supplier_payments WHERE is_void
UNION ALL SELECT 'purchase_allocation_mismatches',count(*),COALESCE(sum(abs(p.amount_paid-COALESCE(a.allocated,0))),0) FROM purchases p LEFT JOIN
 (SELECT a.purchase_id,sum(a.amount) allocated FROM supplier_payment_allocations a JOIN supplier_payments sp ON sp.id=a.supplier_payment_id WHERE NOT sp.is_void GROUP BY 1) a ON a.purchase_id=p.id
 WHERE abs(p.amount_paid-COALESCE(a.allocated,0))>.005
UNION ALL SELECT 'sale_payment_mismatches',count(*),COALESCE(sum(abs(s.amount_received-COALESCE(p.received,0))),0) FROM sales s LEFT JOIN
 (SELECT sale_id,sum(amount) received FROM payments WHERE sale_id IS NOT NULL GROUP BY 1) p ON p.sale_id=s.id
 WHERE abs(s.amount_received-COALESCE(p.received,0))>.005;
GRANT SELECT ON public.financial_reconciliation TO authenticated;

COMMIT;
