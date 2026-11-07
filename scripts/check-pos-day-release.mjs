#!/usr/bin/env node
// Source-level deployment gates. These do not replace database integration tests.
import { readFileSync, existsSync } from "node:fs";
import { strict as assert } from "node:assert";
const read = (p) => readFileSync(p, "utf8");
const dir = "supabase/migrations/";
const files = [
 "20261103000000_pos_daily_closing_foundation.sql",
 "20261107000000_pos_business_day_sales_enforcement.sql",
 "20261107010000_pos_day_reconciliation.sql",
 "20261107020000_pos_day_movements.sql",
 "20261107030000_pos_closing_draft.sql",
 "20261107040000_pos_closing_history.sql",
 "20261107050000_offline_pos_day_sync_guard.sql",
];
for (const f of files) assert.ok(existsSync(dir+f), "Missing POS migration: "+f);
const foundation=read(dir+files[0]);
const sale=read(dir+files[1]);
const reconcile=read(dir+files[2]);
const movement=read(dir+files[3]);
const closing=read(dir+files[4]);
const offline=read(dir+files[6]);
const desktop=read("src/lib/desktop-pos.ts");
const ui=read("src/components/app/PosDayClosing.tsx");
assert.match(foundation,/CREATE TABLE IF NOT EXISTS public\.pos_business_days/);
assert.match(sale,/FOR UPDATE/);
assert.match(sale,/pos_business_day_id = v_day\.id/);
assert.match(reconcile,/WHERE NOT is_voided/);
assert.match(movement,/voided_at IS NULL/);
assert.match(closing,/verify_pos_authorization\(p_password\)/);
assert.match(closing,/'finalization_allowed',false/);
assert.doesNotMatch(closing,/UPDATE\s+public\.pos_business_days\s+SET\s+status\s*=\s*'closed'/i);
assert.match(ui,/not finalized/i);
assert.match(offline,/p_occurred_at timestamptz/);
assert.match(offline,/v_day\.business_date <> v_local_date/);
assert.match(offline,/REVOKE ALL ON FUNCTION public\.sync_pos_sale\(uuid,uuid,uuid,jsonb,text,numeric,text,uuid,text\) FROM PUBLIC,anon,authenticated/);
assert.match(desktop,/p_occurred_at:occurred\.toISOString\(\)/);
assert.match(desktop,/markPosFailed/);
console.log("POS source-level migration and fail-closed checks passed (not runtime DB tests).");
