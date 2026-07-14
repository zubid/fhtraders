
-- Purchases: track payments to suppliers
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';

CREATE OR REPLACE FUNCTION public.set_purchase_payment_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.amount_paid <= 0 THEN NEW.payment_status := 'unpaid';
  ELSIF NEW.amount_paid >= NEW.grand_total THEN NEW.payment_status := 'paid';
  ELSE NEW.payment_status := 'partial';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_set_purchase_payment_status ON public.purchases;
CREATE TRIGGER trg_set_purchase_payment_status
BEFORE INSERT OR UPDATE ON public.purchases
FOR EACH ROW EXECUTE FUNCTION public.set_purchase_payment_status();

-- Supplier payments ledger
CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  purchase_id UUID REFERENCES public.purchases(id) ON DELETE SET NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'cash',
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_payments TO authenticated;
GRANT ALL ON public.supplier_payments TO service_role;

ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view supplier payments" ON public.supplier_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert supplier payments" ON public.supplier_payments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update supplier payments" ON public.supplier_payments FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Admins can delete supplier payments" ON public.supplier_payments FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON public.supplier_payments(supplier_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_purchase ON public.supplier_payments(purchase_id);

CREATE TRIGGER update_supplier_payments_updated_at BEFORE UPDATE ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill payment_status for any existing rows
UPDATE public.purchases SET amount_paid = amount_paid;
