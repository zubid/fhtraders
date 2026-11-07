import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDesktop } from "@/lib/desktop-pos";
import { formatCurrency } from "@/lib/format";
import { Card } from "@/components/ui/card";

type AuditEvent = {
 event_id: string; event_type: "day_opened" | "closing_draft" | "closing_finalized" | "day_closed";
 day_id: string; business_date: string; event_time: string; actor_id: string | null;
 cash_amount: number | null; note: string | null; event_status: string;
};
const labels: Record<AuditEvent["event_type"], string> = {
 day_opened: "Day opened", closing_draft: "Closing draft (not final)", closing_finalized: "Final closing authorized", day_closed: "Day closed",
};
export function PosClosingHistory() {
 const desktop = isDesktop();
 const history = useQuery({
  queryKey: ["pos-closing-history"],
  enabled: !desktop,
  refetchInterval: 30000,
  queryFn: async () => {
   const { data, error } = await (supabase.rpc as any)("get_pos_closing_history", { p_limit: 100 });
   if (error) throw error;
   return (data ?? []) as AuditEvent[];
  },
 });
 if (desktop) return <Card className="p-5">Closing history requires an online connection.</Card>;
 return <Card className="space-y-4 p-5">
  <h3 className="text-lg font-semibold">POS Closing History & Audit Trail</h3>
  <p className="text-sm text-muted-foreground">Most recent 100 opening, draft and finalized-closing events. A draft does not mean the POS day was closed.</p>
  {history.isLoading ? <p>Loading audit history...</p> :
   history.isError ? <p role="alert" className="text-destructive">Cannot load closing history: {(history.error as Error).message}. Ensure the Task 6 migration is applied.</p> :
   !history.data?.length ? <p>No opening or closing activity recorded.</p> :
   <div className="space-y-3">
    {history.data.map(e => <div key={e.event_type + e.event_id} className="rounded-md border p-3">
     <div className="flex flex-wrap items-center justify-between gap-2">
      <strong>{labels[e.event_type] ?? "Closing event"}</strong>
      <span className="text-xs text-muted-foreground">{new Date(e.event_time).toLocaleString("en-PK", {timeZone:"Asia/Karachi"})}</span>
     </div>
     <p className="text-sm">Business date: {e.business_date}</p>
     <p className="text-sm">Recorded cash: {e.cash_amount == null ? "Not recorded" : formatCurrency(Number(e.cash_amount))}</p>
     <p className="text-xs text-muted-foreground">Operator ID: {e.actor_id ?? "Unknown"}</p>
     {e.note && <p className="text-sm">Note: {e.note}</p>}
    </div>)}
   </div>}
 </Card>;
}
