// Pure client-side helpers for the POS final daily close.
// The server (finalize_pos_day_closing) re-checks every rule; these only drive the UI.
export type MovementClass = "none" | "all_cash" | "unclassified";

export type Preflight = {
  day_id: string; business_date: string; status: string; is_stale: boolean;
  reconciliation: { sale_count: number; cash_received_in_day_vault: number; other_vault_payment_count: number };
  movements: { expenses: number; external_topups: number; transfers_in: number; transfers_out: number; customer_refunds: number; supplier_refunds: number };
  unclassified_movement_count: number;
  other_vault_payment_count: number;
  active_devices: { id: string; name: string; location: string | null; last_seen_at: string | null }[];
  pending_operations: { id: string; operation_type: string; status: string; error: string | null }[];
  pos_sales_expected_cash: number;
  expected_cash_if_movements_are_cash: number;
};

export type CloseInput = {
  counted: number; password: string; reason: string;
  deviceIds: string[]; operationIds: string[]; statement: boolean;
  movementClass: MovementClass | ""; movementNote: string;
};

export function expectedCashStatus(p: Preflight, cls: MovementClass): "exact" | "operator_classified" | "unverified" {
  if (cls === "unclassified") return "unverified";
  if (p.other_vault_payment_count > 0 || p.pending_operations.length > 0) return "unverified";
  if (cls === "all_cash") return "operator_classified";
  return "exact";
}

export function expectedCashLabel(p: Preflight, cls: MovementClass): string {
  const s = expectedCashStatus(p, cls);
  return s === "exact" ? "exact" : s === "operator_classified" ? "based on your classification" : "UNVERIFIED — not exact";
}

export function closeReadiness(p: Preflight, i: CloseInput): { ready: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!Number.isFinite(i.counted) || i.counted < 0) problems.push("Enter the physically counted cash");
  if (i.reason.trim().length < 3) problems.push("Enter a closing reason");
  if (!i.password) problems.push("Enter the POS authorization password");
  const missingDev = p.active_devices.filter((d) => !i.deviceIds.includes(d.id)).length;
  if (missingDev) problems.push(`Confirm ${missingDev} offline device(s)`);
  const missingOps = p.pending_operations.filter((o) => !i.operationIds.includes(o.id)).length;
  if (missingOps) problems.push(`Acknowledge ${missingOps} queued offline operation(s)`);
  if (!i.statement) problems.push("Confirm all offline devices are accounted for");
  if (!i.movementClass) problems.push("Confirm the other cash movements");
  else if (i.movementClass === "none" && p.unclassified_movement_count > 0) problems.push("Movements exist; classify them");
  else if (i.movementClass !== "none" && !i.movementNote.trim()) problems.push("Explain the cash movements");
  return { ready: problems.length === 0, problems };
}

export function buildFinalizeArgs(dayId: string, i: CloseInput & { movementClass: MovementClass }) {
  return {
    p_day_id: dayId,
    p_counted_cash: i.counted,
    p_password: i.password,
    p_reason: i.reason.trim(),
    p_offline_attestation: { device_ids: i.deviceIds, pending_operation_ids: i.operationIds, statement: i.statement ? "all devices accounted for" : null },
    p_movement_attestation: { classification: i.movementClass, note: i.movementNote.trim() || null },
    p_confirm: true,
  };
}
