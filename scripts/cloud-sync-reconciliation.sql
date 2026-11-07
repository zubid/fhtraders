-- Read-only cloud synchronization ledger diagnostics. No data is modified.
SELECT
 count(*) FILTER (WHERE status='applied') AS applied_operations,
 count(*) FILTER (WHERE status='received') AS received_operations,
 count(*) FILTER (WHERE status='rejected') AS rejected_operations,
 count(*) FILTER (WHERE status='applied' AND entity_id IS NULL) AS applied_without_cloud_entity,
 count(*) FILTER (WHERE status='received' AND created_at < now() - interval '15 minutes') AS stale_received_operations,
 count(*) FILTER (WHERE status='applied' AND applied_at IS NULL) AS applied_without_timestamp,
 count(*) FILTER (WHERE status='applied' AND entity_type='sales' AND entity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.id=sync_operations.entity_id)) AS applied_sales_missing_cloud_row,
 count(*) FILTER (WHERE status='applied' AND entity_type='purchases' AND entity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.purchases p WHERE p.id=sync_operations.entity_id)) AS applied_purchases_missing_cloud_row,
 count(*) FILTER (WHERE status='applied' AND entity_type='restaurant_payments' AND entity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.payments x WHERE x.id=sync_operations.entity_id)) AS applied_restaurant_payments_missing_cloud_row,
 count(*) FILTER (WHERE status='applied' AND entity_type='supplier_payments' AND entity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.supplier_payments x WHERE x.id=sync_operations.entity_id)) AS applied_supplier_payments_missing_cloud_row,
 count(*) FILTER (WHERE status='applied' AND entity_type='expenses' AND entity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.expenses x WHERE x.id=sync_operations.entity_id)) AS applied_expenses_missing_cloud_row,
 count(*) FILTER (WHERE status='applied' AND entity_type='vault_topups' AND entity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vault_topups x WHERE x.id=sync_operations.entity_id)) AS applied_vault_topups_missing_cloud_row,
 count(*) FILTER (WHERE status='applied' AND entity_type='vault_cash_movements' AND entity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vault_cash_movements x WHERE x.id=sync_operations.entity_id)) AS applied_vault_movements_missing_cloud_row
FROM public.sync_operations;
