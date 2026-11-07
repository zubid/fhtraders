import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { exportPosExcel, printPosDay, type PosExportData, type PosExportRow } from "@/lib/pos-day-exports";

type Snapshot = {
  reconciliation?: Record<string, any>;
  movements?: Record<string, any>;
  pending_operations?: unknown[];
  active_devices?: unknown[];
  unclassified_movement_count?: number;
};
type Day = {
  id: string; business_date: string; status: string;
  opening_cash: number; opened_at?: string | null; closed_at?: string | null;
  counted_cash?: number | null; expected_cash?: number | null;
  cash_difference?: number | null; expected_cash_status?: string | null;
  closing_reason?: string | null; closing_snapshot?: Snapshot | null;
};

const num = (v: unknown) => Number(v ?? 0) || 0;
const add = (rows: PosExportRow[], label: string, value: unknown) => rows.push([label, typeof value === "number" ? value : String(value ?? "Not recorded")]);

export function buildPosFinancialReport(day: Day, snapshot: Snapshot, kind: "X" | "Z"): PosExportData {
  const r = snapshot.reconciliation ?? {};
  const m = snapshot.movements ?? {};
  const rows: PosExportRow[] = [];
  add(rows, "Report type", kind === "X" ? "X - provisional (does not close day)" : "Z - finalized closing snapshot");
  add(rows, "Opened at", day.opened_at ?? "Not recorded");
  if (kind === "Z") add(rows, "Closed at", day.closed_at ?? "Not recorded");
  add(rows, "Opening cash", num(day.opening_cash));
  add(rows, "Active invoices", num(r.sale_count));
  add(rows, "Net sales (after discounts)", num(r.net_sales));
  add(rows, "Total receipts", num(r.total_received));
  add(rows, "Outstanding / overpaid", num(r.outstanding));
  add(rows, "Cash receipts (day vault)", num(r.cash_received_in_day_vault));
  add(rows, "Digital and other receipts", num(r.digital_and_other_received_in_day_vault));
  add(rows, "Receipts in other vaults", num(r.other_vault_receipts));
  for (const [method, amount] of Object.entries(r.payment_methods ?? {})) add(rows, "Payment - " + method, num(amount));
  add(rows, "Expenses (vault/date)", num(m.expenses));
  add(rows, "Customer refunds (vault/date)", num(m.customer_refunds));
  add(rows, "Supplier refunds (vault/date)", num(m.supplier_refunds));
  add(rows, "External top-ups", num(m.external_topups));
  add(rows, "Transfers in", num(m.transfers_in));
  add(rows, "Transfers out", num(m.transfers_out));
  add(rows, "Net recorded vault movements", num(m.known_vault_net_movement));
  add(rows, "Unclassified movement count", num(snapshot.unclassified_movement_count));
  add(rows, "Pending cloud sync operations", snapshot.pending_operations?.length ?? "Not recorded");
  if (kind === "Z") {
    add(rows, "Expected cash (operator classification)", day.expected_cash ?? "Not recorded");
    add(rows, "Expected cash status", day.expected_cash_status ?? "Unverified");
    add(rows, "Physically counted cash", day.counted_cash ?? "Not recorded");
    add(rows, "Cash difference", day.cash_difference ?? "Not recorded");
    add(rows, "Closing reason", day.closing_reason ?? "Not recorded");
  } else {
    add(rows, "Provisional cash before movements", num(r.provisional_expected_cash));
  }
  add(rows, "Gross sales before discounts", "Not separately available in day snapshot");
  add(rows, "Discounts", "Not separately available in day snapshot");
  add(rows, "Voided invoice / item return totals", "Not separately available in day snapshot");
  return {
    businessDate: day.business_date, status: kind === "Z" ? "FINAL Z REPORT" : "PROVISIONAL X REPORT",
    rows,
    disclaimer: kind === "Z"
      ? "Historical closing snapshot. Gross/discount/void totals not captured separately. Offline local pending transactions may be excluded. Cash movements may lack payment-channel classification; see expected cash status. Printing never changes ledger balances."
      : "Provisional read-only report; does not close the day. Pending offline sales excluded. Cash/noncash classification of vault movements may be unknown. Not a final physical cash balance.",
  };
}

export function PosFinancialReportButtons({ dayId, kind }: { dayId: string; kind: "X" | "Z" }) {
  const report = useQuery({
    queryKey: ["pos-financial-report", dayId, kind],
    enabled: !!dayId,
    queryFn: async () => {
      const { data: day, error } = await (supabase.from("pos_business_days" as any) as any)
        .select("id,business_date,status,opening_cash,opened_at,closed_at,counted_cash,expected_cash,cash_difference,expected_cash_status,closing_reason,closing_snapshot")
        .eq("id", dayId).single();
      if (error) throw error;
      if (kind === "Z" && (day.status !== "closed" || !day.closing_snapshot)) throw new Error("Final closing snapshot not available.");
      if (kind === "X" && day.status !== "open") throw new Error("X report requires an open day.");
      let snapshot: Snapshot;
      if (kind === "Z") snapshot = day.closing_snapshot as Snapshot;
      else {
        const { data, error: rpcError } = await (supabase.rpc as any)("get_pos_day_close_preflight", { p_day_id: dayId });
        if (rpcError) throw rpcError;
        snapshot = data as Snapshot;
      }
      return buildPosFinancialReport(day as Day, snapshot, kind);
    },
    staleTime: kind === "Z" ? Infinity : 0,
  });
  const run = (type: "thermal" | "pdf" | "excel") => {
    if (!report.data) return;
    try {
      if (type === "excel") exportPosExcel(report.data);
      else printPosDay(report.data, type === "thermal");
    } catch (e) { window.alert((e as Error).message); }
  };
  return <div className="space-y-2">
    {report.isError && <p role="alert" className="text-sm text-destructive">Report unavailable: {(report.error as Error).message}</p>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={!report.data} onClick={() => run("thermal")}>{kind} Report - 58 mm</Button>
      <Button size="sm" variant="outline" disabled={!report.data} onClick={() => run("pdf")}>Print / PDF</Button>
      <Button size="sm" variant="outline" disabled={!report.data} onClick={() => run("excel")}>Excel</Button>
    </div>
    {kind === "Z" && <p className="text-xs text-muted-foreground">Permanent figures from the closing snapshot. Reprinting does not change the ledger.</p>}
  </div>;
}
