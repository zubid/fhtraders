-- Read-only, actionable exception list. Do not expose operation payloads.
-- Investigate each result before retrying or editing financial transactions.
WITH checked AS (
 SELECT o.operation_id,o.device_id,o.entity_type,o.entity_id,o.status,o.created_at,o.applied_at,
 CASE
 WHEN o.status='applied' AND o.entity_id IS NULL THEN 'applied_without_cloud_entity'
 WHEN o.status='applied' AND o.applied_at IS NULL THEN 'applied_without_timestamp'
 WHEN o.status='received' AND o.created_at < now()-interval '15 minutes' THEN 'stale_received'
 WHEN o.status='applied' AND o.entity_type='sales' AND NOT EXISTS(SELECT 1 FROM public.sales x WHERE x.id=o.entity_id) THEN 'missing_sale'
 WHEN o.status='applied' AND o.entity_type='purchases' AND NOT EXISTS(SELECT 1 FROM public.purchases x WHERE x.id=o.entity_id) THEN 'missing_purchase'
 WHEN o.status='applied' AND o.entity_type='restaurant_payments' AND NOT EXISTS(SELECT 1 FROM public.payments x WHERE x.id=o.entity_id) THEN 'missing_restaurant_payment'
 WHEN o.status='applied' AND o.entity_type='supplier_payments' AND NOT EXISTS(SELECT 1 FROM public.supplier_payments x WHERE x.id=o.entity_id) THEN 'missing_supplier_payment'
 WHEN o.status='applied' AND o.entity_type='expenses' AND NOT EXISTS(SELECT 1 FROM public.expenses x WHERE x.id=o.entity_id) THEN 'missing_expense'
 WHEN o.status='applied' AND o.entity_type='vault_topups' AND NOT EXISTS(SELECT 1 FROM public.vault_topups x WHERE x.id=o.entity_id) THEN 'missing_vault_topup'
 WHEN o.status='applied' AND o.entity_type='vault_cash_movements' AND NOT EXISTS(SELECT 1 FROM public.vault_cash_movements x WHERE x.id=o.entity_id) THEN 'missing_vault_movement'
 WHEN o.status='applied' AND o.entity_type='sale_returns' AND NOT EXISTS(SELECT 1 FROM public.inventory_adjustments x WHERE x.id=o.entity_id AND x.adjustment_type='sale_return') THEN 'missing_or_mismatched_sale_return'
 WHEN o.status='applied' AND o.entity_type='supplier_returns' AND NOT EXISTS(SELECT 1 FROM public.inventory_adjustments x WHERE x.id=o.entity_id AND x.adjustment_type='supplier_return') THEN 'missing_or_mismatched_supplier_return'
 END AS issue
 FROM public.sync_operations o
)
SELECT operation_id,device_id,entity_type,entity_id,status,issue,created_at,applied_at
FROM checked WHERE issue IS NOT NULL
ORDER BY created_at DESC,operation_id
LIMIT 500;
