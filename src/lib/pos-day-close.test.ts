import { describe, expect, it } from "vitest";
import { closeReadiness, expectedCashStatus, type CloseInput, type Preflight } from "./pos-day-close";

const base: Preflight = {
  day_id: "d", business_date: "2026-11-07", status: "open", is_stale: false,
  reconciliation: { sale_count: 1, cash_received_in_day_vault: 100, other_vault_payment_count: 0 },
  movements: { expenses: 0, external_topups: 0, transfers_in: 0, transfers_out: 0, customer_refunds: 0, supplier_refunds: 0 },
  unclassified_movement_count: 0, other_vault_payment_count: 0,
  active_devices: [], pending_operations: [], pos_sales_expected_cash: 1100, expected_cash_if_movements_are_cash: 1100,
};
const ok: CloseInput = { counted: 1100, password: "x", reason: "end of day", deviceIds: [], operationIds: [], statement: true, movementClass: "none", movementNote: "" };

describe("POS final close rules", () => {
  it("is exact only with no movements, no pending offline ops and no other-vault receipts", () => {
    expect(expectedCashStatus(base, "none")).toBe("exact");
  });
  it("never claims exact when movements are unclassified", () => {
    expect(expectedCashStatus({ ...base, unclassified_movement_count: 2 }, "unclassified")).toBe("unverified");
  });
  it("marks unverified when offline operations are still queued", () => {
    expect(expectedCashStatus({ ...base, pending_operations: [{ id: "o", operation_type: "pos_sale", status: "rejected", error: null }] }, "none")).toBe("unverified");
  });
  it("requires a reason", () => {
    expect(closeReadiness(base, { ...ok, reason: " " }).ready).toBe(false);
  });
  it("requires every active device to be attested", () => {
    const p = { ...base, active_devices: [{ id: "dev1", name: "Till", location: null, last_seen_at: null }] };
    expect(closeReadiness(p, ok).ready).toBe(false);
    expect(closeReadiness(p, { ...ok, deviceIds: ["dev1"] }).ready).toBe(true);
  });
  it("refuses 'no movements' when movements exist", () => {
    expect(closeReadiness({ ...base, unclassified_movement_count: 1 }, ok).ready).toBe(false);
  });
  it("accepts a complete attestation", () => {
    expect(closeReadiness(base, ok).ready).toBe(true);
  });
});
