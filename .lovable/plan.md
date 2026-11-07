# POS Daily Opening / Closing — Review and Recommended Sequence

Read-only review. Nothing executed, migrated, deployed or published.

## Findings (verified this turn)

**Live database state**
- None of the daily-close migrations are applied: no `pos_*` tables exist, and no `open_pos_business_day`, `prepare_pos_day_closing`, `get_pos_day_*` or `create_pos_sale_core` functions exist.
- Live `create_pos_sale` is the original 6-argument version, with no business-day check.
- Live `sync_pos_sale` is the legacy 9-argument version (no `p_occurred_at`).
- 100 POS sales exist. 0 active sync devices. 0 pending or failed sync operations.

**Unapplied migrations, in order**
1. `20261103000000_pos_daily_closing_foundation` creates `pos_business_days` (one open day, one row per date, single cash vault), `sales.pos_business_day_id` and `open_pos_business_day`. Its header says "Draft. Not for production."
2. `20261107000000_pos_business_day_sales_enforcement` renames the live `create_pos_sale` to `_core` and wraps it. Sales are refused unless an open day exists for **today**, using the same vault.
3. `20261107010000_pos_day_reconciliation`: read-only expected-cash report.
4. `20261107020000_pos_day_movements`: read-only movement list.
5. `20261107030000_pos_closing_draft`: password-checked count saved as a **draft only**. The check constraint `status='draft'` makes a final close impossible.
6. `20261107040000_pos_closing_history`: history reader, plus revoking writes on the attempts table.
7. `20261107050000_offline_pos_day_sync_guard`: a new 10-argument `sync_pos_sale` that requires `p_occurred_at`, rejects sales from another date, and revokes the 9-argument version.

(`20261102000000_fix_pos_password_safe_update` is earlier and separate. Check it independently.)

**Blocking defects if 1–7 are applied as-is**
- **Next-day deadlock.** No function ever sets `status='closed'`. Once yesterday's day stays open, migration 2 refuses every sale ("open POS day is from X, not today"), and `open_pos_business_day` refuses to open a new day ("already open"). POS stops completely until someone edits the database by hand.
- **POS blocked the moment it's applied.** No day is open at deploy time, so every sale fails until someone opens one.
- **Frontend and database don't match today.** `src/lib/desktop-pos.ts` already sends `p_occurred_at` to the 10-argument `sync_pos_sale`, which isn't live. Any desktop offline sync in the published app would fail with "function not found" today. The daily-close components also call RPCs that don't exist yet.
- **Edits to closed days aren't guarded.** `pos_edit_sale`, `pos_item_less` and `void_pos_sale` can still change sales that belong to a day that's already closed. This would silently change a finalized cash count.
- **Rejected offline sales have nowhere to go.** Migration 7 correctly refuses to move an offline sale onto another day, but there is no path to post it to its original (closed) day. It just stays queued forever.
- **Unclear cash isn't captured.** Vault transfers, supplier or expense payments from the POS vault, and restaurant receipts during the day are listed (migration 4). But the operator never confirms how they were counted at close.

## Recommended smallest correct changes

New migration A, `pos_day_final_close` (additive only):
- Allow `pos_day_closing_attempts.status` to be `draft | finalized | superseded`. Add `expected_cash`, `difference`, `snapshot jsonb`, `offline_attestation jsonb`, `movement_attestation jsonb`.
- `finalize_pos_day_closing(p_day_id, p_counted_cash, p_password, p_reason, p_offline_attestation jsonb, p_movement_attestation jsonb)`, SECURITY DEFINER:
  - Check role and password with `_pos_guard`, and require a reason. Lock the day row `FOR UPDATE`. The day must be open.
  - Recompute expected cash on the server with the reconciliation function. Never trust a number from the client.
  - **Offline attestation:** each active sync device must be listed as either "synced, nothing pending" or "unreachable, acknowledged". Any pending or failed `sync_operations` must be listed by ID. Refuse if any are missing.
  - **Unclear cash attestation:** every unclear movement ID returned by `get_pos_day_movements` must be listed as included or excluded, with a note. Refuse if any are missing.
  - Write the finalized attempt, mark earlier drafts as superseded, set day `status='closed'` with the count, difference and snapshot, and add an `activity_logs` row.
- Add a guard to `pos_edit_sale`, `pos_item_less` and `void_pos_sale`: refuse when the sale's business day is closed ("Day closed. Record a correction on the current day").
- `open_pos_business_day`: keep it as is. It works once the previous day can be closed. Optionally show the previous day's counted cash as a suggested opening amount, without enforcing it.

New migration B, `offline_late_sale_review`:
- Rejected offline sales stay queued as `needs_review`. They are never posted automatically.
- An admin-only `post_late_offline_sale(op_id, password, reason)` posts the sale to its **original date's** day. That day's record gets a `late_adjustments` entry added (append-only, so the finalized count isn't changed) and an audit log. No sale is ever moved to another day.

Frontend:
- `PosDayClosing.tsx`: add a Finalize step after the draft. It shows the server's expected cash and difference, a device checklist, and a checklist for unclear movements. Final close needs the password and a reason.
- POS screen: if no day is open, or the open day is stale, show a "Close previous day / Open today" banner instead of a raw error.
- Closing history: show finalized closes, superseded drafts and late adjustments.

## Deploy sequence (staging first)

```text
1. Branch/staging DB cloned from prod schema + anonymized sales
2. Apply 1103 -> 1107_00..05 -> A -> B in one release (never 1107_00 alone)
3. Verify (below); then prod during off-hours:
   a. Pause desktop clients / confirm 0 pending sync ops
   b. Apply migrations
   c. Admin immediately opens today's day (POS blocked until then)
   d. Publish frontend in same window (desktop-pos.ts depends on 10-arg sync)
```

## Compatibility risks
- Migration 2 renames `create_pos_sale`. Anything that calls `_core` directly or depends on the return shape needs checking. The rename is idempotent, but a rollback must rename it back.
- Migration 7 revokes the 9-argument sync. Older desktop builds still in use will fail to sync until they're updated, and their queued sales stay queued. This is safe, but it needs to be communicated.
- `business_date` uses the server's date. Confirm the timezone (Asia/Karachi) is used the same way in migrations 2 and 7 and the client. Otherwise sales near midnight get rejected.
- A single cash vault per day: POS sales made from another vault will be refused after deploy.
- The open-day unique index on `status`: closing must update that row in the same transaction before a new day opens. This is fine, but needs a test for two people opening at once.
- Existing 100 POS sales have `pos_business_day_id = NULL`. Reports must treat these as "before daily close", with no backfill.

## Staging verification checklist
- Open, sell, draft, finalize, open next day, then sell on the next day.
- Leave yesterday's day open: POS shows the banner, can close yesterday, then open today.
- Finalize with a wrong password, no reason, a missing device or movement confirmation, or a client-supplied expected cash: each is refused, and the day stays open.
- Edit, item-less or void on a closed day's sale is refused. On an open day it still works.
- Offline sale from yesterday after close: goes to review, is posted only by an admin to yesterday, the late adjustment is recorded and the finalized count is unchanged.
- Two people opening a day at the same time, or finalizing twice: only one succeeds.
- Vault balances and stock match before and after for every scenario. Test rows are rolled back (match the existing `tests/db/*.test.sql` style).

## Open questions (assumed defaults)
- Who can finalize: assumed admin **and** staff, both with the password. Opening is also allowed for both.
- A difference over the threshold: assumed it's allowed with a required reason, not blocked.
