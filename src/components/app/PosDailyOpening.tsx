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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type BusinessDay = {
  id: string; business_date: string; status: "open" | "closed";
  opening_cash: number; opening_note: string | null;
  counted_cash: number | null; expected_cash: number | null; closed_at: string | null;
  vault_user_id: string;
};
type Vault = { id: string; name: string };

export function PosDailyOpening() {
  const qc = useQueryClient();
  const [openingCash, setOpeningCash] = useState("");
  const [vaultId, setVaultId] = useState("");
  const [note, setNote] = useState("");
  const desktop = isDesktop();

  const days = useQuery({
    queryKey: ["pos-business-days"],
    enabled: !desktop,
    queryFn: async () => {
      const { data, error } = await (supabase.from("pos_business_days" as any) as any)
        .select("id,business_date,status,opening_cash,opening_note,counted_cash,expected_cash,closed_at,vault_user_id")
        .order("business_date", { ascending: false }).limit(40);
      if (error) throw error;
      return (data ?? []) as BusinessDay[];
    },
  });
  const vaults = useQuery({
    queryKey: ["pos-opening-vaults"],
    enabled: !desktop,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("list_business_cash_vaults");
      if (error) throw error;
      return (data ?? []) as Vault[];
    },
  });
  const opening = days.data?.find((d) => d.status === "open");
  const previous = days.data?.find((d) => d.status === "closed");
  const open = useMutation({
    mutationFn: async () => {
      if (desktop) throw new Error("Daily opening requires an online connection.");
      const amount = Number(openingCash);
      if (!openingCash.trim() || !Number.isFinite(amount) || amount < 0)
        throw new Error("Enter a valid opening cash amount.");
      if (!vaultId) throw new Error("Select a business cash vault.");
      const { data, error } = await (supabase.rpc as any)("open_pos_business_day", {
        p_opening_cash: amount, p_vault_user_id: vaultId, p_note: note.trim() || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      toast.success("POS business day opened.");
      setOpeningCash(""); setNote("");
      await qc.invalidateQueries({ queryKey: ["pos-business-days"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (desktop) return <Card className="p-5">
    <p className="font-semibold">Daily Opening — online only</p>
    <p className="mt-2 text-sm text-muted-foreground">Desktop offline opening is not supported yet. Do not use this screen to infer that offline sales are linked to a business day.</p>
  </Card>;

  return <div className="grid gap-4 lg:grid-cols-2">
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="text-lg font-semibold">Task 1 — Daily POS Opening</h3>
        <p className="text-sm text-muted-foreground">Business date is assigned by the server (Pakistan time). Only one POS day can be open.</p>
      </div>
      {days.isLoading ? <p>Loading business day...</p> : days.isError ?
        <p role="alert" className="text-sm text-destructive">Could not load POS days: {(days.error as Error).message}. This feature requires the POS daily-opening database migration.</p> :
        opening ? <div className="space-y-2">
          <p className="font-semibold text-green-700">POS day open: {opening.business_date}</p>
          <p>Opening cash: {formatCurrency(opening.opening_cash)}</p>
          <p className="text-sm text-muted-foreground">Closing and sales enforcement are scheduled for subsequent tasks.</p>
        </div> : <>
          <div className="space-y-1">
            <Label htmlFor="pos-opening-cash">Counted opening cash (PKR)</Label>
            <Input id="pos-opening-cash" type="number" min="0" step="0.01" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} placeholder="0.00" />
          </div>
          <div className="space-y-1">
            <Label>Business cash vault</Label>
            <Select value={vaultId} onValueChange={setVaultId}>
              <SelectTrigger><SelectValue placeholder="Select vault" /></SelectTrigger>
              <SelectContent>{(vaults.data ?? []).map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
            {vaults.isError && <p className="text-sm text-destructive">Unable to load cash vaults.</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="pos-opening-note">Opening note (optional)</Label>
            <Input id="pos-opening-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </div>
          <Button disabled={open.isPending || vaults.isLoading || days.isLoading || !vaultId} onClick={() => open.mutate()}>
            {open.isPending ? "Opening..." : "Confirm POS Opening"}
          </Button>
        </>}
    </Card>
    <Card className="space-y-3 p-5">
      <h3 className="text-lg font-semibold">Previous Closing Reference</h3>
      {previous ? <>
        <p>Business date: {previous.business_date}</p>
        <p>Counted closing cash: {previous.counted_cash == null ? "Not recorded" : formatCurrency(previous.counted_cash)}</p>
        <p>Expected cash: {previous.expected_cash == null ? "Not recorded" : formatCurrency(previous.expected_cash)}</p>
        <p className="text-sm text-muted-foreground">Reference only. Opening cash must be counted and entered manually.</p>
      </> : <p className="text-sm text-muted-foreground">No completed POS closing recorded yet.</p>}
    </Card>
  </div>;
}
