CREATE TABLE IF NOT EXISTS public.activity_logs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
 user_id uuid, action text NOT NULL, entity_type text NOT NULL, entity_id uuid,
 reference text, summary text NOT NULL, old_data jsonb, new_data jsonb, metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON public.activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON public.activity_logs(entity_type,entity_id);
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read activity logs" ON public.activity_logs;
CREATE POLICY "Authenticated read activity logs" ON public.activity_logs FOR SELECT TO authenticated USING(true);
GRANT SELECT ON public.activity_logs TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_row_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE eid uuid; ref text; act text; oldj jsonb; newj jsonb;
BEGIN
 oldj:=CASE WHEN TG_OP IN('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END;
 newj:=CASE WHEN TG_OP IN('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
 eid:=COALESCE((newj->>'id')::uuid,(oldj->>'id')::uuid);
 act:=lower(TG_OP);
 ref:=COALESCE(newj->>'reference_no',newj->>'invoice_no',oldj->>'reference_no',oldj->>'invoice_no');
 INSERT INTO public.activity_logs(user_id,action,entity_type,entity_id,reference,summary,old_data,new_data)
 VALUES(auth.uid(),act,TG_TABLE_NAME,eid,ref,initcap(TG_OP)||' on '||replace(TG_TABLE_NAME,'_',' '),oldj,newj);
 RETURN COALESCE(NEW,OLD);
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['purchases','purchase_items','sales','sale_items','products','payments','supplier_payments','expenses','vault_topups','vault_cash_movements','inventory_adjustments','vault_adjustments']
 LOOP
   EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON public.%I',t,t);
   EXECUTE format('CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()',t,t);
 END LOOP;
END $$;