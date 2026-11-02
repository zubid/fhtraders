-- Draft: POS daily close foundation. Not for production until cash movements/offline are integrated.
CREATE TABLE IF NOT EXISTS public.pos_business_days (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_date date NOT NULL UNIQUE,
 vault_user_id uuid NOT NULL REFERENCES public.vault_users(id),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 opening_cash numeric NOT NULL CHECK(opening_cash>=0),
 opening_note text, opened_by uuid NOT NULL, opened_at timestamptz NOT NULL DEFAULT now(),
 counted_cash numeric CHECK(counted_cash>=0), expected_cash numeric, cash_difference numeric,
 closing_note text, closing_snapshot jsonb, closed_by uuid, closed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_one_open_day ON public.pos_business_days(status) WHERE status='open';
ALTER TABLE public.pos_business_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_business_days FROM PUBLIC,anon;
GRANT SELECT ON public.pos_business_days TO authenticated;
CREATE POLICY "POS staff read days" ON public.pos_business_days FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff'));
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS pos_business_day_id uuid REFERENCES public.pos_business_days(id);
CREATE INDEX IF NOT EXISTS sales_pos_business_day_idx ON public.sales(pos_business_day_id);
CREATE OR REPLACE FUNCTION public.open_pos_business_day(p_opening_cash numeric,p_vault_user_id uuid,p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF p_opening_cash IS NULL OR p_opening_cash<0 THEN RAISE EXCEPTION 'Invalid opening cash'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vault_users WHERE id=p_vault_user_id AND vault_type='business_cash' AND is_active) THEN RAISE EXCEPTION 'Choose active business cash vault'; END IF;
 IF EXISTS(SELECT 1 FROM public.pos_business_days WHERE status='open') THEN RAISE EXCEPTION 'POS day already open'; END IF;
 INSERT INTO public.pos_business_days(business_date,vault_user_id,opening_cash,opening_note,opened_by)
 VALUES((now() AT TIME ZONE 'Asia/Karachi')::date,p_vault_user_id,p_opening_cash,NULLIF(btrim(p_note),''),auth.uid()) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.open_pos_business_day(numeric,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.open_pos_business_day(numeric,uuid,text) TO authenticated;
