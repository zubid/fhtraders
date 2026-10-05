-- Offline-first Step 1: cloud sync foundation.
-- Backward-compatible: no existing IDs, prices, stock, balances or business transactions are modified.

CREATE TABLE IF NOT EXISTS public.sync_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location_label text,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sync_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL UNIQUE,
  device_id uuid REFERENCES public.sync_devices(id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  entity_id uuid,
  operation_type text NOT NULL CHECK (operation_type IN ('insert','update','delete','void','return','payment','adjustment')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('received','applied','rejected')),
  error_message text,
  applied_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_operations_device_created ON public.sync_operations(device_id,created_at);
CREATE INDEX IF NOT EXISTS idx_sync_operations_entity ON public.sync_operations(entity_type,entity_id);

CREATE TABLE IF NOT EXISTS public.sync_changes (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  operation text NOT NULL CHECK(operation IN ('insert','update','delete')),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_changes_seq ON public.sync_changes(seq);
CREATE INDEX IF NOT EXISTS idx_sync_changes_entity ON public.sync_changes(entity_type,entity_id);

CREATE OR REPLACE FUNCTION public.capture_sync_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid;
BEGIN
  rid := CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  INSERT INTO public.sync_changes(entity_type,entity_id,operation)
  VALUES(TG_TABLE_NAME,rid,lower(TG_OP));
  RETURN COALESCE(NEW,OLD);
END $$;

DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'products','categories','restaurants','suppliers','employees','vault_users',
    'sales','sale_items','purchases','purchase_items','payments','supplier_payments',
    'expenses','vault_topups','vault_cash_movements','inventory_adjustments','vault_adjustments'
  ] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_change_%I ON public.%I',t,t);
      EXECUTE format('CREATE TRIGGER trg_sync_change_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.capture_sync_change()',t,t);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.register_sync_device(p_device_key uuid,p_name text,p_location_label text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE did uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NULLIF(btrim(p_name),'') IS NULL THEN RAISE EXCEPTION 'Device name is required'; END IF;
 INSERT INTO public.sync_devices(device_key,name,location_label,last_seen_at,created_by)
 VALUES(p_device_key,btrim(p_name),NULLIF(btrim(p_location_label),''),now(),auth.uid())
 ON CONFLICT(device_key) DO UPDATE SET name=excluded.name,location_label=excluded.location_label,last_seen_at=now(),updated_at=now()
 RETURNING id INTO did;
 RETURN did;
END $$;

CREATE OR REPLACE FUNCTION public.claim_sync_operation(
 p_operation_id uuid,p_device_id uuid,p_entity_type text,p_entity_id uuid,p_operation_type text,p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 INSERT INTO public.sync_operations(operation_id,device_id,entity_type,entity_id,operation_type,payload,status,applied_at,created_by)
 VALUES(p_operation_id,p_device_id,p_entity_type,p_entity_id,p_operation_type,COALESCE(p_payload,'{}'::jsonb),'received',NULL,auth.uid())
 ON CONFLICT(operation_id) DO NOTHING;
 RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.finish_sync_operation(p_operation_id uuid,p_success boolean,p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 UPDATE public.sync_operations SET status=CASE WHEN p_success THEN 'applied' ELSE 'rejected' END,
 applied_at=CASE WHEN p_success THEN now() ELSE applied_at END,error_message=CASE WHEN p_success THEN NULL ELSE p_error END
 WHERE operation_id=p_operation_id;
END $$;

ALTER TABLE public.sync_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read sync devices" ON public.sync_devices;
DROP POLICY IF EXISTS "Authenticated read sync operations" ON public.sync_operations;
DROP POLICY IF EXISTS "Authenticated read sync changes" ON public.sync_changes;
CREATE POLICY "Authenticated read sync devices" ON public.sync_devices FOR SELECT TO authenticated USING(true);
CREATE POLICY "Authenticated read sync operations" ON public.sync_operations FOR SELECT TO authenticated USING(true);
CREATE POLICY "Authenticated read sync changes" ON public.sync_changes FOR SELECT TO authenticated USING(true);
GRANT SELECT ON public.sync_devices,public.sync_operations,public.sync_changes TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_sync_device(uuid,text,text),public.claim_sync_operation(uuid,uuid,text,uuid,text,jsonb),public.finish_sync_operation(uuid,boolean,text) TO authenticated;

COMMENT ON TABLE public.sync_operations IS 'Idempotency ledger for offline device operations. operation_id must be stable across retries.';
COMMENT ON TABLE public.sync_changes IS 'Monotonic cloud change feed cursor for future desktop pull synchronization.';