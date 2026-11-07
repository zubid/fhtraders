-- Read-only preflight: run before cloud reconciliation reports.
-- Returns one row per missing table/column; zero rows means required schema is present.
WITH required(table_name,column_name) AS (
 VALUES
 ('sync_operations','operation_id'),('sync_operations','device_id'),('sync_operations','entity_type'),
 ('sync_operations','entity_id'),('sync_operations','status'),('sync_operations','created_at'),
 ('sync_operations','applied_at'),
 ('sales','id'),('purchases','id'),('payments','id'),('supplier_payments','id'),
 ('expenses','id'),('vault_topups','id'),('vault_cash_movements','id'),
 ('inventory_adjustments','id'),('inventory_adjustments','adjustment_type')
)
SELECT r.table_name,r.column_name,
 CASE WHEN t.table_name IS NULL THEN 'missing_table' ELSE 'missing_column' END AS issue
FROM required r
LEFT JOIN information_schema.tables t ON t.table_schema='public' AND t.table_name=r.table_name AND t.table_type IN ('BASE TABLE','VIEW','FOREIGN')
LEFT JOIN information_schema.columns c ON c.table_schema='public' AND c.table_name=r.table_name AND c.column_name=r.column_name
WHERE t.table_name IS NULL OR c.column_name IS NULL
ORDER BY r.table_name,r.column_name;
