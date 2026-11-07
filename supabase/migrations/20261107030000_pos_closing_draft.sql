-- Task 5: audited, password-protected POS day closing.
-- Fail closed until cash-channel attribution and offline pending checks
-- are implemented in Tasks 4/8. Never finalize an unverified drawer.
CREATE TABLE IF NOT EXISTS public.pos_day_closing_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 pos_business_day_id uuid NOT NULL REFERENCES public.pos_business_days(id),
 counted_cash numeric NOT NULL CHECK (counted_cash >= 0),
 closing_note text,
 attempted_by uuid NOT NULL,
 attempted_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'draft' CHECK (status='draft')
);
ALTER TABLE public.pos_day_closing_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_day_closing_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.pos_day_closing_attempts TO authenticated;
CREATE POLICY "Staff read POS closing drafts" ON public.pos_day_closing_attempts
 FOR SELECT TO authenticated
 USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));

CREATE OR REPLACE FUNCTION public.prepare_pos_day_closing(
 p_day_id uuid,p_counted_cash numeric,p_password text,p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.pos_business_days%ROWTYPE; v_attempt uuid; v_reconciliation jsonb; v_movements jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) THEN
  RAISE EXCEPTION 'Not authorized';
 END IF;
 IF NOT public.verify_pos_authorization(p_password) THEN
  RAISE EXCEPTION 'Incorrect POS authorization password';
 END IF;
 IF p_counted_cash IS NULL OR p_counted_cash < 0 THEN
  RAISE EXCEPTION 'Counted cash must be zero or greater';
 END IF;
 SELECT * INTO d FROM public.pos_business_days WHERE id=p_day_id FOR UPDATE;
 IF NOT FOUND OR d.status<>'open' THEN RAISE EXCEPTION 'Only an open POS day can be prepared for closing'; END IF;
 v_reconciliation := public.get_pos_day_reconciliation(p_day_id);
 v_movements := public.get_pos_day_movements(p_day_id);
 INSERT INTO public.pos_day_closing_attempts(pos_business_day_id,counted_cash,closing_note,attempted_by)
 VALUES(p_day_id,p_counted_cash,NULLIF(btrim(p_note),''),auth.uid()) RETURNING id INTO v_attempt;
 RETURN jsonb_build_object(
  'draft_id',v_attempt,'status','draft','business_date',d.business_date,
  'counted_cash',p_counted_cash,
  'provisional_expected_cash',v_reconciliation->'provisional_expected_cash',
  'provisional_difference',p_counted_cash-(v_reconciliation->>'provisional_expected_cash')::numeric,
  'sales_reconciliation',v_reconciliation,'vault_movements',v_movements,
  'finalization_allowed',false,
  'blockers',jsonb_build_array(
   'Cash versus non-cash attribution for expenses, refunds and transfers is not available',
   'Offline pending-sale verification is not implemented',
   'Closing totals are provisional until Tasks 4 and 8 safeguards are completed'
  )
 );
END $$;
REVOKE ALL ON FUNCTION public.prepare_pos_day_closing(uuid,numeric,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_pos_day_closing(uuid,numeric,text,text) TO authenticated;
