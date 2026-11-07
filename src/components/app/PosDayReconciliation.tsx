import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDesktop } from "@/lib/desktop-pos";
import { formatCurrency } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Day = { id: string; business_date: string; status: string };
type Reconciliation = {
  business_date: string; status: string; opening_cash: number; sale_count: number;
  net_sales: number; total_received: number; outstanding: number;
  cash_received_in_day_vault: number; digital_and_other_received_in_day_vault: number;
  other_vault_receipts: number; other_vault_payment_count: number;
  provisional_expected_cash: number; payment_methods: Record<string,number>; scope: string;
};
type Movements = {
  expenses: number; expense_count: number; external_topups: number; topup_count: number;
  transfers_in: number; transfer_in_count: number; transfers_out: number; transfer_out_count: number;
  customer_refunds: number; customer_refund_count: number; supplier_refunds: number; supplier_refund_count: number;
  known_vault_net_movement: number; scope: string;
};
const money = (v: number) => formatCurrency(Number(v) || 0);

export function PosDayReconciliation() {
  const [dayId, setDayId] = useState("");
  const desktop = isDesktop();
  const days = useQuery({
    queryKey: ["pos-reconciliation-days"],
    enabled: !desktop,
    queryFn: async () => {
      const { data, error } = await (supabase.from("pos_business_days" as any) as any)
        .select("id,business_date,status").order("business_date", { ascending: false }).limit(60);
      if (error) throw error;
      return (data ?? []) as Day[];
    },
  });
  const selected = dayId || days.data?.[0]?.id || "";
  const report = useQuery({
    queryKey: ["pos-day-reconciliation", selected],
    enabled: !desktop && !!selected,
    refetchInterval: 20000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_pos_day_reconciliation", { p_day_id: selected });
      if (error) throw error;
      return data as Reconciliation;
    },
  });
  const movements = useQuery({
    queryKey: ["pos-day-movements", selected],
    enabled: !desktop && !!selected,
    refetchInterval: 20000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_pos_day_movements", { p_day_id: selected });
      if (error) throw error;
      return data as Movements;
    },
  });
  if (desktop) return <Card className="p-5">Online reconciliation is not available in offline desktop mode. Pending offline transactions are excluded.</Card>;
  return <Card className="space-y-4 p-5">
    <div>
      <h3 className="text-lg font-semibold">Task 3 — POS Day Reconciliation</h3>
      <p className="text-sm text-muted-foreground">Read-only sales and payment summary. No closing or vault adjustment is performed.</p>
    </div>
    {days.isError && <p role="alert" className="text-destructive">Cannot load POS days: {(days.error as Error).message}</p>}
    {days.isLoading ? <p>Loading days...</p> : !days.data?.length ? <p>No POS business days recorded.</p> : <>
      <Select value={selected} onValueChange={setDayId}>
        <SelectTrigger><SelectValue placeholder="Select business day" /></SelectTrigger>
        <SelectContent>{days.data.map(d => <SelectItem key={d.id} value={d.id}>{d.business_date} — {d.status}</SelectItem>)}</SelectContent>
      </Select>
      {report.isLoading ? <p>Calculating reconciliation...</p> : report.isError ?
        <p role="alert" className="text-destructive">Reconciliation unavailable: {(report.error as Error).message}. Apply the Task 3 migration before using this report.</p> :
        report.data && <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["Opening cash", report.data.opening_cash],
              ["POS sales", report.data.net_sales],
              ["Total payments received", report.data.total_received],
              ["Unpaid / overpaid difference", report.data.outstanding],
              ["Cash received in day vault", report.data.cash_received_in_day_vault],
              ["Digital / other in day vault", report.data.digital_and_other_received_in_day_vault],
              ["Other-vault receipts (review)", report.data.other_vault_receipts],
              ["Provisional cash before movements", report.data.provisional_expected_cash],
            ] as [string,number][]).map(([label, value]) =>
              <div key={label} className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-lg font-semibold">{money(value)}</p>
              </div>
            )}
          </div>
          <p className="text-sm">Active POS invoices: <strong>{report.data.sale_count}</strong></p>
          <div>
            <h4 className="font-medium">Receipts by payment method (selected vault)</h4>
            {Object.keys(report.data.payment_methods || {}).length === 0 ?
              <p className="text-sm text-muted-foreground">No receipts recorded.</p> :
              Object.entries(report.data.payment_methods).map(([method, amount]) =>
                <div key={method} className="flex justify-between border-b py-2 text-sm"><span>{method}</span><strong>{money(amount)}</strong></div>
              )}
          </div>
          {report.data.other_vault_payment_count > 0 && <p role="alert" className="text-sm text-amber-700">Warning: {report.data.other_vault_payment_count} payment(s) were recorded in another vault. Review before closing.</p>}
          <p className="text-sm text-muted-foreground">{report.data.scope}. The provisional cash figure is not a final closing balance.</p>
          <div className="space-y-3 border-t pt-4">
            <h4 className="font-semibold">Task 4 — Refunds, Expenses & Vault Movements</h4>
            {movements.isLoading ? <p>Loading movements...</p> : movements.isError ?
              <p role="alert" className="text-sm text-destructive">Movement report unavailable: {(movements.error as Error).message}. Apply Task 4 migration.</p> :
              movements.data && <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {([
                    ["Expenses", movements.data.expenses],
                    ["Customer refunds", movements.data.customer_refunds],
                    ["Supplier refunds received", movements.data.supplier_refunds],
                    ["External top-ups", movements.data.external_topups],
                    ["Transfers in", movements.data.transfers_in],
                    ["Transfers out", movements.data.transfers_out],
                    ["Net recorded vault movements", movements.data.known_vault_net_movement],
                  ] as [string,number][]).map(([label,value]) =>
                    <div key={label} className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-lg font-semibold">{money(value)}</p>
                    </div>)}
                </div>
                <p className="text-sm text-muted-foreground">{movements.data.scope}</p>
                <p role="note" className="text-sm font-medium">These movements are not automatically added to the provisional cash drawer total. Historical records lack POS-day links and payment-channel classification, so treating all of them as physical cash could give a false closing balance.</p>
              </>}
          </div>
        </div>}
    </>}
  </Card>;
}
