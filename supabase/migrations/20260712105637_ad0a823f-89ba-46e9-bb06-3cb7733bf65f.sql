
-- 1. Credit columns on sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS amount_received numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid';

-- Recompute payment_status automatically
CREATE OR REPLACE FUNCTION public.set_sale_payment_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.amount_received <= 0 THEN
    NEW.payment_status := 'unpaid';
  ELSIF NEW.amount_received >= NEW.grand_total THEN
    NEW.payment_status := 'paid';
  ELSE
    NEW.payment_status := 'partial';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sale_payment_status ON public.sales;
CREATE TRIGGER trg_sale_payment_status
  BEFORE INSERT OR UPDATE OF amount_received, grand_total ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.set_sale_payment_status();

-- Backfill statuses for existing rows
UPDATE public.sales SET amount_received = amount_received;

-- 2. Payments ledger
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT 'cash',
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view payments"
  ON public.payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can record payments"
  ON public.payments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update payments"
  ON public.payments FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Admins can delete payments"
  ON public.payments FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_payments_restaurant ON public.payments(restaurant_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_sale ON public.payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_sales_restaurant_date ON public.sales(restaurant_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_payment_status ON public.sales(payment_status);
