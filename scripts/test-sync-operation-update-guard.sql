\set ON_ERROR_STOP on
CREATE SCHEMA IF NOT EXISTS public;
CREATE TABLE public.sync_operations (
 operation_id uuid PRIMARY KEY,
 device_id uuid,
 entity_id uuid,
 entity_type text,
 operation_type text,
 payload jsonb DEFAULT '{}'::jsonb,
 status text NOT NULL
);
\i supabase/migrations/20261107150000_protect_applied_sync_operation_updates.sql
INSERT INTO public.sync_operations(operation_id,status,entity_id,entity_type,operation_type) VALUES
 ('11111111-1111-4111-8111-111111111111','applied','33333333-3333-4333-8333-333333333333','sales','insert'),
 ('22222222-2222-4222-8222-222222222222','received',NULL,'sales','insert');
DO $$
DECLARE blocked boolean;
BEGIN
 blocked:=false;
 BEGIN
  UPDATE public.sync_operations SET status='rejected' WHERE operation_id='11111111-1111-4111-8111-111111111111';
 EXCEPTION WHEN check_violation THEN blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'Applied status downgrade was not blocked'; END IF;
 blocked:=false;
 BEGIN
  UPDATE public.sync_operations SET entity_id='44444444-4444-4444-8444-444444444444' WHERE operation_id='11111111-1111-4111-8111-111111111111';
 EXCEPTION WHEN check_violation THEN blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'Applied entity reassignment was not blocked'; END IF;
 IF (SELECT status FROM public.sync_operations WHERE operation_id='11111111-1111-4111-8111-111111111111') <> 'applied' THEN
  RAISE EXCEPTION 'Applied status changed unexpectedly';
 END IF;
END $$;
UPDATE public.sync_operations SET status='applied' WHERE operation_id='22222222-2222-4222-8222-222222222222';
SELECT 'Applied sync operation update guard passed' AS result;
