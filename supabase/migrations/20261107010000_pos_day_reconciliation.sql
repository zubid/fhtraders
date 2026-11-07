-- Task 3: read-only POS day tender reconciliation.
-- Sales totals are reported separately from receipts. Receipts are grouped
-- from payment records (not sale.payment_method) to avoid misclassifying
-- split/edited tenders. Refunds, cash expenses and transfers are Task 4.
CREATE OR REPLACE FUNCTION public.get_pos_day_reconciliation(p_day_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
 v_day public.pos_business_days%ROWTYPE;
 v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) THEN
   RAISE EXCEPTION 'Not authorized';
 END IF;
 SELECT * INTO v_day FROM public.pos_business_days WHERE id = p_day_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'POS business day not found'; END IF;

 WITH day_sales AS (
   SELECT id, grand_total, COALESCE(is_voided,false) AS is_voided
   FROM public.sales
   WHERE pos_business_day_id = p_day_id AND source = 'pos'
 ),
 active_sales AS (
   SELECT id, grand_total FROM day_sales WHERE NOT is_voided
 ),
 tender AS (
   SELECT p.method, COALESCE(SUM(p.amount),0) AS amount, COUNT(*) AS payment_count
   FROM public.payments p
   JOIN active_sales s ON s.id = p.sale_id
   -- Restrict to the vault selected for this POS day; mismatches are
   -- surfaced separately rather than silently counted in the cash drawer.
   WHERE p.vault_user_id = v_day.vault_user_id
   GROUP BY p.method
 ),
 other_vault AS (
   SELECT COALESCE(SUM(p.amount),0) AS amount, COUNT(*) AS payment_count
   FROM public.payments p JOIN active_sales s ON s.id = p.sale_id
   WHERE p.vault_user_id IS DISTINCT FROM v_day.vault_user_id
 ),
 totals AS (
   SELECT COUNT(*) AS sale_count, COALESCE(SUM(grand_total),0) AS net_sales
   FROM active_sales
 ),
 paid AS (
   SELECT COALESCE(SUM(p.amount),0) AS paid_total
   FROM public.payments p JOIN active_sales s ON s.id=p.sale_id
 ),
 by_method AS (
   SELECT COALESCE(jsonb_object_agg(method,amount),'{}'::jsonb) AS amounts,
          COALESCE(SUM(amount) FILTER (WHERE method='cash'),0) AS cash,
          COALESCE(SUM(amount) FILTER (WHERE method<>'cash'),0) AS noncash
   FROM tender
 )
 SELECT jsonb_build_object(
   'day_id',v_day.id,'business_date',v_day.business_date,
   'status',v_day.status,'opening_cash',v_day.opening_cash,
   'sale_count',totals.sale_count,'net_sales',totals.net_sales,
   'total_received',paid.paid_total,
   'outstanding',totals.net_sales-paid.paid_total,
   'cash_received_in_day_vault',by_method.cash,
   'digital_and_other_received_in_day_vault',by_method.noncash,
   'payment_methods',by_method.amounts,
   'other_vault_receipts',other_vault.amount,
   'other_vault_payment_count',other_vault.payment_count,
   'provisional_expected_cash',v_day.opening_cash+by_method.cash,
   'scope','POS linked sales and their payment records only; refunds, expenses, transfers, offline pending and non-POS receipts excluded'
 ) INTO v_result
 FROM totals CROSS JOIN paid CROSS JOIN by_method CROSS JOIN other_vault;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.get_pos_day_reconciliation(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_pos_day_reconciliation(uuid) TO authenticated;
