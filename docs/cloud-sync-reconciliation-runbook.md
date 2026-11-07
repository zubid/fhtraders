# Cloud sync reconciliation: safe verification runbook

These checks **read** cloud data only. They do not repair ledger records, replay transactions, or alter sales, purchases, stock, or balances.

## Preconditions

1. Confirm the **FHTraders production Supabase project ID and database** with the owner before accessing it. Do not use a similarly named project or infer the correct target from a GitHub secret.
2. Use a read-only database account, preferably against a read replica. Do not copy database passwords or financial payloads into issues or logs.
3. Verify that the live schema includes `public.sync_operations` and the referenced transaction tables: `sales`, `purchases`, `payments`, `supplier_payments`, `expenses`, `vault_topups`, `vault_cash_movements`, `inventory_adjustments`. Check actual schema before running the scripts; isolated CI fixtures do not prove production schema compatibility.
4. Agree on a low-traffic inspection window. The reports may scan large tables.

## Run against the confirmed target

Use a secure connection string held outside shell history, with a **read-only** database role. In an interactive `psql` session, first check:

```sql
SELECT current_database(), current_user;
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('sync_operations','sales','purchases','payments',
    'supplier_payments','expenses','vault_topups','vault_cash_movements',
    'inventory_adjustments')
ORDER BY table_name;
```

If any required table is absent, **stop** and reconcile schema differences in the repository first. Do not create tables or apply migrations as a workaround.

Execute each report inside a read-only transaction:

```sql
BEGIN READ ONLY;
\i scripts/cloud-sync-reconciliation.sql
\i scripts/cloud-sync-reconciliation-exceptions.sql
ROLLBACK;
```

The exception report returns at most 500 rows, newest first; a 500-row result is **not** evidence that there are only 500 exceptions. The summary report is needed for totals. A read-only transaction is a safety measure, not a substitute for read-only credentials.

## Interpret and escalate

- `applied_without_cloud_entity` or `missing_*`: possible missing transaction or invalid cloud acknowledgement. **Do not** delete the sync operation or replay it: replay can duplicate financial transactions.
- `stale_received`: operation still in progress or interrupted; investigate timestamps and device connectivity before taking action.
- `applied_without_timestamp`: incomplete audit metadata; check history before any repair.
- `missing_or_mismatched_*_return`: return audit record absent or of the wrong adjustment type; reconcile with stock ledger and source transaction.

Record only operation IDs, issue categories, counts, and approved timestamps in a restricted incident ticket. Compare affected cloud transactions to the originating device's local SQLite ledger and outbox before proposing any correction. Never assume a discrepancy is safe to fix automatically.

## Acceptance criteria

- The production project identity and schema are confirmed.
- Both read-only queries execute successfully.
- Summary counts and a bounded sample of exceptions are reviewed.
- Every nonzero exception category has an investigation owner and disposition.
- No production write, migration, operation replay, or financial correction occurs without separate approval and a reviewed recovery plan.
