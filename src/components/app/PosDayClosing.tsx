import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isDesktop } from "@/lib/desktop-pos";
import { formatCurrency } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { PosFinancialReportButtons } from "@/components/app/PosFinancialReport";
import {
  buildFinalizeArgs, closeReadiness, expectedCashLabel,
  type MovementClass, type Preflight,
} from "@/lib/pos-day-close";

type Day = { id: string; business_date: string; opening_cash: number };

function friendly(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  if (/finalize_pos_day_closing|get_pos_day_close_preflight|Could not find the function/i.test(m))
    return "Final closing is not installed on the server yet. An admin must apply the pending daily-close update first.";
  if (/not configured/i.test(m)) return "No POS authorization password is set yet. An admin must set it in Settings → Security.";
  return m;
}

export function PosDayClosing() {
  const desktop = isDesktop();
  const qc = useQueryClient();
  const [cash, setCash] = useState("");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [devices, setDevices] = useState<string[]>([]);
  const [ops, setOps] = useState<string[]>([]);
  const [statement, setStatement] = useState(false);
  const [mvClass, setMvClass] = useState<MovementClass | "">("");
  const [mvNote, setMvNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const day = useQuery({
    queryKey: ["pos-closing-open-day"],
    enabled: !desktop,
    queryFn: async () => {
      const { data, error } = await (supabase.from("pos_business_days" as any) as any)
        .select("id,business_date,opening_cash").eq("status", "open").maybeSingle();
      if (error) throw error;
      return data as Day | null;
    },
  });
  const pf = useQuery({
    queryKey: ["pos-close-preflight", day.data?.id],
    enabled: !!day.data,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_pos_day_close_preflight", { p_day_id: day.data!.id });
      if (error) throw error;
      return data as Preflight;
    },
  });
  useEffect(() => { setDevices([]); setOps([]); setStatement(false); setMvClass(""); setMvNote(""); }, [pf.data?.day_id]);

  const counted = cash.trim() === "" ? NaN : Number(cash);
  const readiness = pf.data ? closeReadiness(pf.data, {
    counted, password, reason, deviceIds: devices, operationIds: ops, statement, movementClass: mvClass, movementNote: mvNote,
  }) : { ready: false, problems: ["Loading checks"] };

  const finalize = useMutation({
    mutationFn: async () => {
      const args = buildFinalizeArgs(day.data!.id, {
        counted, password, reason, deviceIds: devices, operationIds: ops, statement, movementClass: mvClass as MovementClass, movementNote: mvNote,
      });
      const { data, error } = await (supabase.rpc as any)("finalize_pos_day_closing", args);
      if (error) throw error;
      return data as { business_date: string; expected_cash_status: string; difference: number };
    },
    onSuccess: async (r) => {
      setPassword(""); setCash(""); setReason(""); setConfirmOpen(false);
      toast.success(`POS day ${r.business_date} closed. Print your Z report from Closing History.`);
      await qc.invalidateQueries({ queryKey: ["pos-business-days"] });
      await qc.invalidateQueries({ queryKey: ["pos-closing-open-day"] });
    },
    onError: (e) => { setConfirmOpen(false); toast.error(friendly(e)); },
  });

  if (desktop) return <Card className="p-5">Closing requires an online connection. Sync this device first.</Card>;
  const toggle = (list: string[], set: (v: string[]) => void, id: string, on: boolean) =>
    set(on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  const p = pf.data;

  return <Card className="max-w-3xl space-y-5 p-5">
    <div>
      <h3 className="text-lg font-semibold">Final Daily Closing</h3>
      <p className="text-sm text-muted-foreground">Count the drawer, confirm offline devices and cash movements, then close. Closed days cannot be edited.</p>
    </div>
    {day.isLoading ? <p>Checking open day...</p> : day.isError ? <p role="alert" className="text-destructive">{friendly(day.error)}</p>
    : !day.data ? <p>No open POS day. Open the next day from the Opening tab.</p>
    : pf.isLoading ? <p>Loading closing checks...</p> : pf.isError || !p ? <p role="alert" className="text-destructive">{friendly(pf.error)}</p>
    : <>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <p>Day: <strong>{p.business_date}</strong>{p.is_stale && <span className="ml-2 text-destructive">(earlier day — close it to open today)</span>}</p>
        <p>Opening cash: <strong>{formatCurrency(day.data.opening_cash)}</strong></p>
        <p>POS cash receipts: <strong>{formatCurrency(p.reconciliation.cash_received_in_day_vault)}</strong></p>
        <p>Sales count: <strong>{p.reconciliation.sale_count}</strong></p>
      </div>

      <section className="space-y-2 rounded-md border p-4">
        <h4 className="font-semibold">X Report — print before closing</h4>
        <PosFinancialReportButtons dayId={day.data.id} kind="X" />
      </section>
      <section className="space-y-2 rounded-md border p-4">
        <h4 className="font-semibold">1. Offline devices</h4>
        {p.active_devices.length === 0 ? <p className="text-sm text-muted-foreground">No registered offline devices.</p> :
          p.active_devices.map((d) => <label key={d.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={devices.includes(d.id)} onCheckedChange={(v) => toggle(devices, setDevices, d.id, !!v)} />
            {d.name}{d.location ? ` — ${d.location}` : ""} · last seen {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "never"} — I confirm it is synced or its unsynced sales stay queued
          </label>)}
        {p.pending_operations.length > 0 && <div className="space-y-1">
          <p className="text-sm font-medium text-destructive">{p.pending_operations.length} offline operation(s) not posted. They stay queued and are NOT moved into this day.</p>
          {p.pending_operations.map((o) => <label key={o.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={ops.includes(o.id)} onCheckedChange={(v) => toggle(ops, setOps, o.id, !!v)} />
            {o.operation_type} · {o.status}{o.error ? ` — ${o.error}` : ""}
          </label>)}
        </div>}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={statement} onCheckedChange={(v) => setStatement(!!v)} />
          I confirm all offline devices for this day are listed above and accounted for.
        </label>
      </section>

      <section className="space-y-2 rounded-md border p-4">
        <h4 className="font-semibold">2. Other cash movements in this vault today</h4>
        {p.unclassified_movement_count === 0 ? <p className="text-sm text-muted-foreground">None found.</p> : <>
          <p className="text-sm">{p.unclassified_movement_count} movement(s): expenses {formatCurrency(p.movements.expenses)}, top-ups {formatCurrency(p.movements.external_topups)}, transfers in {formatCurrency(p.movements.transfers_in)}, out {formatCurrency(p.movements.transfers_out)}, refunds {formatCurrency(p.movements.customer_refunds)}. The system cannot tell if these were cash.</p>
        </>}
        <div className="flex flex-wrap gap-2">
          {(p.unclassified_movement_count === 0 ? ["none"] : ["all_cash", "unclassified"]).map((c) =>
            <Button key={c} type="button" size="sm" variant={mvClass === c ? "default" : "outline"} onClick={() => setMvClass(c as MovementClass)}>
              {c === "none" ? "Confirm: no other movements" : c === "all_cash" ? "All were drawer cash" : "Not sure / mixed"}
            </Button>)}
        </div>
        {mvClass && mvClass !== "none" && <Textarea placeholder="Explain these movements (required)" value={mvNote} maxLength={500} onChange={(e) => setMvNote(e.target.value)} />}
        {p.other_vault_payment_count > 0 && <p className="text-sm text-destructive">{p.other_vault_payment_count} POS payment(s) went to a different vault; expected cash will be marked unverified.</p>}
      </section>

      <section className="space-y-3 rounded-md border p-4">
        <h4 className="font-semibold">3. Count and authorize</h4>
        <div className="space-y-1"><Label htmlFor="closing-counted">Physically counted cash (PKR)</Label>
          <Input id="closing-counted" type="number" min="0" step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} /></div>
        {mvClass && Number.isFinite(counted) && <p className="text-sm">Expected cash: <strong>{formatCurrency(mvClass === "all_cash" ? p.expected_cash_if_movements_are_cash : p.pos_sales_expected_cash)}</strong> — {expectedCashLabel(p, mvClass as MovementClass)} · Difference: <strong>{formatCurrency(counted - (mvClass === "all_cash" ? p.expected_cash_if_movements_are_cash : p.pos_sales_expected_cash))}</strong></p>}
        <div className="space-y-1"><Label htmlFor="closing-reason">Closing reason / note (required)</Label>
          <Input id="closing-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="closing-password">POS authorization password</Label>
          <Input id="closing-password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {!readiness.ready && <ul className="list-disc pl-5 text-sm text-muted-foreground">{readiness.problems.map((x) => <li key={x}>{x}</li>)}</ul>}
        <Button disabled={!readiness.ready || finalize.isPending} onClick={() => setConfirmOpen(true)}>Finalize & Close Day</Button>
      </section>
    </>}
    <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen}
      title={`Close POS day ${p?.business_date ?? ""}?`}
      description="This is final. Sales of this day can no longer be edited, reduced or voided. Unsynced offline sales stay queued and are not moved to another day."
      confirmLabel={finalize.isPending ? "Closing..." : "Yes, close the day"}
      onConfirm={() => finalize.mutate()} />
  </Card>;
}
