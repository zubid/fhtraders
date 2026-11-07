-- Task 6: immutable closing history / audit reader.
-- Drafts are attempts, not finalized closings. No final closing exists yet.
CREATE OR REPLACE FUNCTION public.get_pos_closing_history(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_rows jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff')) THEN
  RAISE EXCEPTION 'Not authorized';
 END IF;
 IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN RAISE EXCEPTION 'Limit must be 1 to 200'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.event_time DESC, x.event_id DESC),'[]'::jsonb)
 INTO v_rows
 FROM (
   SELECT d.id AS event_id, 'day_opened'::text AS event_type, d.id AS day_id,
     d.business_date, d.opened_at AS event_time, d.opened_by AS actor_id,
     d.opening_cash AS cash_amount, d.opening_note AS note,
     'open'::text AS event_status
   FROM public.pos_business_days d
   UNION ALL
   SELECT a.id, 'closing_draft', a.pos_business_day_id, d.business_date,
     a.attempted_at, a.attempted_by, a.counted_cash, a.closing_note, 'draft'
   FROM public.pos_day_closing_attempts a
   JOIN public.pos_business_days d ON d.id=a.pos_business_day_id
   UNION ALL
   SELECT d.id, 'day_closed', d.id, d.business_date,
     d.closed_at, d.closed_by, d.counted_cash, d.closing_note, 'closed'
   FROM public.pos_business_days d WHERE d.status='closed' AND d.closed_at IS NOT NULL
 ) x ORDER BY x.event_time DESC, x.event_id DESC LIMIT p_limit;
 RETURN v_rows;
END $$;
REVOKE ALL ON FUNCTION public.get_pos_closing_history(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_pos_closing_history(integer) TO authenticated;
-- Append-only audit protection. Neither staff nor admins may modify prior drafts.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.pos_day_closing_attempts FROM authenticated;
