-- POS module schema and atomic sale workflow.
-- Kept in Supabase migration history so fresh environments match production.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_method text;
CREATE INDEX IF NOT EXISTS idx_sales_source ON public.sales(source, created_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_source_check' AND conrelid = 'public.sales'::regclass) THEN
    ALTER TABLE public.sales ADD CONSTRAINT sales_source_check CHECK (source IN ('manual','pos'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_selling_price_nonneg' AND conrelid = 'public.products'::regclass) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_selling_price_nonneg CHECK (default_selling_price >= 0) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.payments ALTER COLUMN restaurant_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.list_business_cash_vaults()
RETURNS TABLE(id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.id, v.name FROM public.vault_users v
  WHERE v.is_active AND v.vault_type = 'business_cash'
    AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'))
  ORDER BY v.name;
$$;
REVOKE ALL ON FUNCTION public.list_business_cash_vaults() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_business_cash_vaults() TO authenticated;

CREATE OR REPLACE FUNCTION public.create_pos_sale(
  p_items jsonb, p_customer_name text, p_discount numeric,
  p_method text, p_vault_user_id uuid, p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_item jsonb; v_pid uuid; v_qty numeric; v_price numeric;
  v_stock numeric; v_name text; v_avg numeric;
  v_sub numeric := 0; v_cost numeric := 0; v_grand numeric; v_disc numeric := COALESCE(p_discount,0);
  v_sale public.sales;
BEGIN
  IF v_uid IS NULL OR NOT (public.has_role(v_uid,'admin') OR public.has_role(v_uid,'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash','bank','upi','other') THEN RAISE EXCEPTION 'Invalid payment method'; END IF;
  IF v_disc < 0 THEN RAISE EXCEPTION 'Discount cannot be negative'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    v_price := (v_item->>'unit_price')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
    IF v_price IS NULL OR v_price < 0 THEN RAISE EXCEPTION 'Invalid price'; END IF;
    SELECT current_stock, name, avg_cost INTO v_stock, v_name, v_avg
      FROM public.products WHERE id = v_pid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    IF v_qty > v_stock THEN RAISE EXCEPTION 'Insufficient stock for %: available %', v_name, v_stock; END IF;
    v_sub := v_sub + v_qty * v_price;
    v_cost := v_cost + v_qty * COALESCE(v_avg,0);
  END LOOP;

  IF v_disc > v_sub THEN RAISE EXCEPTION 'Discount exceeds subtotal'; END IF;
  v_grand := v_sub - v_disc;

  IF v_grand > 0 AND p_vault_user_id IS NULL THEN RAISE EXCEPTION 'Business Cash Vault is required'; END IF;
  IF p_vault_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.vault_users
    WHERE id = p_vault_user_id AND is_active AND vault_type = 'business_cash'
  ) THEN RAISE EXCEPTION 'Selected Business Cash Vault is not active'; END IF;

  INSERT INTO public.sales (restaurant_id, sale_date, subtotal, discount, tax, grand_total, total_cost, notes,
    created_by, amount_received, source, customer_name, payment_method)
  VALUES (NULL, CURRENT_DATE, v_sub, v_disc, 0, v_grand, v_cost, NULLIF(trim(p_note),''),
    v_uid, 0, 'pos', NULLIF(trim(p_customer_name),''), p_method)
  RETURNING * INTO v_sale;

  INSERT INTO public.sale_items (sale_id, product_id, quantity, unit_price, cost_price, line_total)
  SELECT v_sale.id, (e->>'product_id')::uuid, (e->>'quantity')::numeric, (e->>'unit_price')::numeric, 0,
         (e->>'quantity')::numeric * (e->>'unit_price')::numeric
  FROM jsonb_array_elements(p_items) e;

  IF v_grand > 0 THEN
    INSERT INTO public.payments (restaurant_id, sale_id, payment_date, amount, method, note, created_by, vault_user_id)
    VALUES (NULL, v_sale.id, CURRENT_DATE, v_grand, p_method, 'POS ' || v_sale.invoice_no, v_uid, p_vault_user_id);
    UPDATE public.sales SET amount_received = v_grand WHERE id = v_sale.id;
  END IF;

  RETURN jsonb_build_object('id', v_sale.id, 'invoice_no', v_sale.invoice_no);
END $$;
REVOKE ALL ON FUNCTION public.create_pos_sale(jsonb,text,numeric,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pos_sale(jsonb,text,numeric,text,uuid,text) TO authenticated;
