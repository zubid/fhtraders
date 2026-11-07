-- Task 4: read-only reconciliation of cash outflows and movements.
-- This is a calendar-day/vault view, NOT a definitive drawer close:
-- existing expenses/topups/transfers have no pos_business_day_id or tender type.
-- Refund adjustments have no tender type either. Do not assume all are cash.
CREATE OR REPLACE FUNCTION public.get_pos_day_movements(p_day_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.pos_business_days%ROWTYPE; v jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) THEN
   RAISE EXCEPTION 'Not authorized';
 END IF;
 SELECT * INTO d FROM public.pos_business_days WHERE id=p_day_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'POS business day not found'; END IF;
 WITH expense_totals AS (
   SELECT COALESCE(SUM(e.amount),0) amount, COUNT(*) entries
   FROM public.expenses e
   WHERE e.vault_user_id=d.vault_user_id AND e.expense_date=d.business_date
 ),
 topup_totals AS (
   SELECT COALESCE(SUM(t.amount),0) amount, COUNT(*) entries
   FROM public.vault_topups t
   WHERE t.vault_user_id=d.vault_user_id AND t.topup_date=d.business_date
 ),
 transfer_in AS (
   SELECT COALESCE(SUM(m.amount),0) amount, COUNT(*) entries
   FROM public.vault_cash_movements m
   WHERE m.destination_vault_user_id=d.vault_user_id AND m.movement_date=d.business_date AND m.voided_at IS NULL
 ),
 transfer_out AS (
   SELECT COALESCE(SUM(m.amount),0) amount, COUNT(*) entries
   FROM public.vault_cash_movements m
   WHERE m.source_vault_user_id=d.vault_user_id AND m.movement_date=d.business_date AND m.voided_at IS NULL
 ),
 customer_refunds AS (
   SELECT COALESCE(SUM(a.amount),0) amount, COUNT(*) entries
   FROM public.vault_adjustments a
   WHERE a.vault_user_id=d.vault_user_id AND a.adjustment_type='customer_refund'
     AND (a.created_at AT TIME ZONE 'Asia/Karachi')::date=d.business_date
 ),
 supplier_refunds AS (
   SELECT COALESCE(SUM(a.amount),0) amount, COUNT(*) entries
   FROM public.vault_adjustments a
   WHERE a.vault_user_id=d.vault_user_id AND a.adjustment_type='supplier_refund'
     AND (a.created_at AT TIME ZONE 'Asia/Karachi')::date=d.business_date
 )
 SELECT jsonb_build_object(
   'day_id',d.id,'business_date',d.business_date,'vault_user_id',d.vault_user_id,
   'expenses',e.amount,'expense_count',e.entries,
   'external_topups',t.amount,'topup_count',t.entries,
   'transfers_in',i.amount,'transfer_in_count',i.entries,
   'transfers_out',o.amount,'transfer_out_count',o.entries,
   'customer_refunds',cr.amount,'customer_refund_count',cr.entries,
   'supplier_refunds',sr.amount,'supplier_refund_count',sr.entries,
   'known_vault_net_movement',t.amount+i.amount+sr.amount-e.amount-o.amount-cr.amount,
   'scope','Date and selected vault only. May include non-POS operations; cash vs bank is not known for these records. Do not use as a final physical-cash calculation.'
 ) INTO v
 FROM expense_totals e CROSS JOIN topup_totals t CROSS JOIN transfer_in i
 CROSS JOIN transfer_out o CROSS JOIN customer_refunds cr CROSS JOIN supplier_refunds sr;
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.get_pos_day_movements(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_pos_day_movements(uuid) TO authenticated;
