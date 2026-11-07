# POS Daily Closing — Task 9 release gate

**Status: code prepared; production deployment blocked until the correct FH Traders database and integration tests are verified.** Do not apply these migrations to a database merely because its project name resembles FH Traders.

## Database identification (read-only)

The connected Supabase project named `food-hub-traders` (`ieobziivsrcfhatloyxz`) was checked on 2026-11-07 and **does not have** `public.sales`, `public.pos_business_days`, or the POS sale RPC. It is **not verified as this application's POS database**. No schema changes were made there.

Before deployment, identify the actual Lovable-managed PostgreSQL instance used by the running FH Traders application, compare its project URL to the runtime configuration, and perform this read-only preflight:

```sql
SELECT current_database(), current_user, now();
SELECT to_regclass('public.sales') AS sales,
       to_regclass('public.payments') AS payments,
       to_regclass('public.vault_users') AS vault_users,
       to_regclass('public.pos_business_days') AS pos_business_days,
       to_regprocedure('public.create_pos_sale(jsonb,text,numeric,text,uuid,text)') AS create_pos_sale,
       to_regprocedure('public.sync_pos_sale(uuid,uuid,uuid,jsonb,text,numeric,text,uuid,text)') AS old_sync_rpc;
SELECT table_name,column_name,data_type
FROM information_schema.columns
WHERE table_schema='public'
AND table_name IN ('sales','payments','expenses','vault_topups','vault_cash_movements','vault_adjustments')
ORDER BY table_name,ordinal_position;
```

Take a verified backup and test on a staging copy **before** any production migration. Review any Lovable-managed migration history to avoid reapplying existing DDL.

## Required ordered migrations

1. `20261103000000_pos_daily_closing_foundation.sql`
2. `20261107000000_pos_business_day_sales_enforcement.sql`
3. `20261107010000_pos_day_reconciliation.sql`
4. `20261107020000_pos_day_movements.sql`
5. `20261107030000_pos_closing_draft.sql`
6. `20261107040000_pos_closing_history.sql`
7. `20261107050000_offline_pos_day_sync_guard.sql`

**Rollout is not backwards compatible:** Task 2 requires a current open day for web POS sales. Task 8 revokes the legacy 9-argument offline sync endpoint; old desktop builds will fail to sync. Coordinate deployment and desktop client update, and reconcile all pending outbox operations before switching. Do not deploy to a busy production POS without a maintenance window and rollback plan.

## Test plan — all must pass on the correct staging database

- Application build and source-level checks in GitHub Actions.
- Migration apply from an empty/staging schema with existing baseline, plus a migration-upgrade test on a copy of current production.
- Authorized and unauthorized opening; duplicate opening; stale-day opening; mismatched vault.
- Online sale success and atomic day association; blocked sale with no day; no partial stock/payment changes after a rejected sale.
- Cash, bank, UPI, other, split payment and voided sale reconciliation against known invoices.
- Expenses, refunds, topups and transfers against known vault ledger; verify they are not incorrectly treated as physical cash.
- Password rejection and acceptance for closing draft; audit history and staff authorization; verify final close is unavailable.
- Offline sale created yesterday, synced today: must remain queued, not silently redate. Verify duplicate retry and vault mismatch. Test desktop client update order and multiple devices.
- 58mm physical printer, A4 Save as PDF, Excel-compatible .xls opening and formulas/data.
- Backup/restore rehearsal, rollback plan, performance and security checks.

## Release blockers

- Correct POS production database **not identified** through available Supabase connection.
- Actual migrations **not deployed**; no end-to-end/live tests executed.
- Final daily closing is deliberately disabled: physical-cash channel classification and cross-device offline queue reconciliation are incomplete.
- Historical offline transactions require a defined manual reconciliation procedure.
- No verified printer or Windows desktop installer test for these changes.

**Do not describe the POS daily closing system as production-ready or mark Task 9 complete until these gates pass.**
