\set ON_ERROR_STOP on
CREATE SCHEMA IF NOT EXISTS public;
CREATE TABLE public.sales(id uuid PRIMARY KEY);
CREATE TABLE public.purchases(id uuid PRIMARY KEY);
CREATE TABLE public.payments(id uuid PRIMARY KEY);
CREATE TABLE public.supplier_payments(id uuid PRIMARY KEY);
CREATE TABLE public.expenses(id uuid PRIMARY KEY);
CREATE TABLE public.vault_topups(id uuid PRIMARY KEY);
CREATE TABLE public.vault_cash_movements(id uuid PRIMARY KEY);
CREATE TABLE public.inventory_adjustments(id uuid PRIMARY KEY, adjustment_type text NOT NULL);
CREATE TABLE public.sync_operations(operation_id uuid PRIMARY KEY,device_id uuid,entity_type text NOT NULL,entity_id uuid,status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),applied_at timestamptz);
INSERT INTO public.sales(id) VALUES('11111111-1111-4111-8111-111111111111');
INSERT INTO public.sync_operations(operation_id,entity_type,entity_id,status,applied_at) VALUES
 ('22222222-2222-4222-8222-222222222222','sales','11111111-1111-4111-8111-111111111111','applied',now()),
 ('33333333-3333-4333-8333-333333333333','sales','44444444-4444-4444-8444-444444444444','applied',now()),
 ('55555555-5555-4555-8555-555555555555','purchases',NULL,'applied',now()),
 ('66666666-6666-4666-8666-666666666666','sales',NULL,'received',NULL);
INSERT INTO public.sync_operations(operation_id,entity_type,entity_id,status,applied_at) VALUES
 ('77777777-7777-4777-8777-777777777777','restaurant_payments','88888888-8888-4888-8888-888888888888','applied',now());
INSERT INTO public.inventory_adjustments(id,adjustment_type) VALUES('99999999-9999-4999-8999-999999999999','supplier_return');
INSERT INTO public.sync_operations(operation_id,entity_type,entity_id,status,applied_at) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sale_returns','99999999-9999-4999-8999-999999999999','applied',now()),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','supplier_returns','99999999-9999-4999-8999-999999999999','applied',now());
\i scripts/cloud-sync-reconciliation.sql
\i scripts/cloud-sync-reconciliation-exceptions.sql
DO $$ BEGIN
 IF (SELECT count(*) FROM public.sync_operations WHERE status='applied' AND entity_id IS NULL) <> 1 THEN RAISE EXCEPTION 'Missing entity fixture mismatch'; END IF;
 IF (SELECT count(*) FROM public.sync_operations o WHERE status='applied' AND entity_type='sales' AND NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=o.entity_id)) <> 1 THEN RAISE EXCEPTION 'Missing sale fixture mismatch'; END IF;
 IF (SELECT count(*) FROM public.sync_operations o WHERE status='applied' AND entity_type='restaurant_payments' AND NOT EXISTS(SELECT 1 FROM public.payments x WHERE x.id=o.entity_id)) <> 1 THEN RAISE EXCEPTION 'Missing payment fixture mismatch'; END IF;
 IF (SELECT count(*) FROM public.sync_operations o WHERE status='applied' AND entity_type='sale_returns' AND NOT EXISTS(SELECT 1 FROM public.inventory_adjustments x WHERE x.id=o.entity_id AND x.adjustment_type='sale_return')) <> 1 THEN RAISE EXCEPTION 'Wrong return adjustment type was not detected'; END IF;
 IF (SELECT count(*) FROM public.sync_operations o WHERE status='applied' AND entity_type='supplier_returns' AND NOT EXISTS(SELECT 1 FROM public.inventory_adjustments x WHERE x.id=o.entity_id AND x.adjustment_type='supplier_return')) <> 0 THEN RAISE EXCEPTION 'Valid supplier return was flagged'; END IF;
END $$;
