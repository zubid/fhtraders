\set ON_ERROR_STOP on
CREATE SCHEMA IF NOT EXISTS public;
CREATE TABLE public.sync_operations (
 operation_id uuid PRIMARY KEY,
 status text NOT NULL
);
\i supabase/migrations/20261107140000_protect_applied_sync_operations.sql
INSERT INTO public.sync_operations(operation_id,status) VALUES
 ('11111111-1111-4111-8111-111111111111','applied'),
 ('22222222-2222-4222-8222-222222222222','received');
DO $$
BEGIN
 BEGIN
  DELETE FROM public.sync_operations WHERE operation_id='11111111-1111-4111-8111-111111111111';
  RAISE EXCEPTION 'Expected applied operation deletion to be blocked';
 EXCEPTION WHEN check_violation THEN
  NULL;
 END;
 IF NOT EXISTS(SELECT 1 FROM public.sync_operations WHERE operation_id='11111111-1111-4111-8111-111111111111') THEN
  RAISE EXCEPTION 'Applied operation was deleted';
 END IF;
END $$;
DELETE FROM public.sync_operations WHERE operation_id='22222222-2222-4222-8222-222222222222';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.sync_operations WHERE operation_id='22222222-2222-4222-8222-222222222222') THEN
  RAISE EXCEPTION 'Received operation should be deletable';
 END IF;
END $$;
SELECT 'Applied sync idempotency deletion guard passed' AS result;
