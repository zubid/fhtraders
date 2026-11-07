import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isDesktop } from "@/lib/desktop-pos";
import { formatCurrency } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Day = { id: string; business_date: string; opening_cash: number };
type Draft = {
  draft_id: string; business_date: string; counted_cash: number;
  provisional_expected_cash: number; provisional_difference: number;
  finalization_allowed: boolean; blockers: string[];
};

export function PosDayClosing() {
 const desktop = isDesktop();
 const qc = useQueryClient();
 const [cash,setCash] = useState("");
 const [password,setPassword] = useState("");
 const [note,setNote] = useState("");
 const [draft,setDraft] = useState<Draft | null>(null);
 const day = useQuery({
   queryKey:["pos-closing-open-day"],
   enabled:!desktop,
   queryFn:async()=>{
     const {data,error}=await (supabase.from("pos_business_days" as any) as any)
       .select("id,business_date,opening_cash").eq("status","open").maybeSingle();
     if(error) throw error;
     return data as Day | null;
   },
 });
 const prepare = useMutation({
   mutationFn:async()=>{
     if(!day.data) throw new Error("No open POS day");
     const counted=Number(cash);
     if(!cash.trim() || !Number.isFinite(counted) || counted<0)
       throw new Error("Enter a valid counted cash amount");
     if(!password) throw new Error("Authorization password is required");
     const {data,error}=await (supabase.rpc as any)("prepare_pos_day_closing",{
       p_day_id:day.data.id,p_counted_cash:counted,p_password:password,p_note:note.trim()||null,
     });
     if(error) throw error;
     return data as Draft;
   },
   onSuccess:async(data)=>{
     setDraft(data);setPassword("");
     toast.success("Closing draft saved. POS day remains open.");
     await qc.invalidateQueries({queryKey:["pos-business-days"]});
   },
   onError:(error:Error)=>toast.error(error.message),
 });
 if(desktop) return <Card className="p-5">Closing requires an online connection and reconciliation of pending offline sales.</Card>;
 return <Card className="max-w-2xl space-y-4 p-5">
   <h3 className="text-lg font-semibold">Task 5 — Secure Daily Closing</h3>
   <p className="text-sm text-muted-foreground">Prepare an authorized closing draft. Final closing is intentionally blocked until cash-channel and offline safeguards are implemented.</p>
   {day.isLoading ? <p>Checking open day...</p> : day.isError ?
     <p role="alert" className="text-destructive">{(day.error as Error).message}</p> :
     !day.data ? <p>No open POS day. Open a day first.</p> : <>
       <p>Open day: <strong>{day.data.business_date}</strong></p>
       <p>Opening cash: <strong>{formatCurrency(day.data.opening_cash)}</strong></p>
       <div className="space-y-1"><Label htmlFor="closing-counted">Physically counted cash (PKR)</Label>
         <Input id="closing-counted" type="number" min="0" step="0.01" value={cash} onChange={e=>{setCash(e.target.value);setDraft(null);}} /></div>
       <div className="space-y-1"><Label htmlFor="closing-note">Closing note (optional)</Label>
         <Input id="closing-note" value={note} maxLength={500} onChange={e=>setNote(e.target.value)} /></div>
       <div className="space-y-1"><Label htmlFor="closing-password">POS authorization password</Label>
         <Input id="closing-password" type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)} /></div>
       <Button disabled={prepare.isPending || !cash.trim() || !password} onClick={()=>prepare.mutate()}>
         {prepare.isPending ? "Preparing..." : "Authorize & Save Closing Draft"}
       </Button>
     </>}
   {draft && <div className="space-y-2 rounded-md border p-4" role="status">
     <p className="font-semibold">Closing draft saved — not finalized</p>
     <p>Counted cash: {formatCurrency(draft.counted_cash)}</p>
     <p>Provisional expected cash: {formatCurrency(draft.provisional_expected_cash)}</p>
     <p>Provisional shortage/excess: {formatCurrency(draft.provisional_difference)}</p>
     <p className="text-sm font-semibold">Final closing blocked until:</p>
     <ul className="list-disc space-y-1 pl-5 text-sm">{draft.blockers.map(x=><li key={x}>{x}</li>)}</ul>
   </div>}
 </Card>;
}
