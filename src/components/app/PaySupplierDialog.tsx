import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { paySupplier, purchaseBalance, PAYMENT_METHODS, METHOD_LABELS } from "@/lib/supplier-credit";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export function PaySupplierDialog({
  open,
  onOpenChange,
  supplierId,
  supplierName,
  presetPurchaseId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  supplierId: string;
  supplierName?: string;
  presetPurchaseId?: string;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState<string>("cash");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [target, setTarget] = useState<string>("fifo");
  const [vaultUserId, setVaultUserId] = useState<string>("");

  const { data: purchases } = useQuery({
    queryKey: ["unpaid-purchases", supplierId],
    enabled: open && !!supplierId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select("id, reference_no, grand_total, amount_paid, purchase_date, payment_status")
        .eq("supplier_id", supplierId)
        .order("purchase_date", { ascending: true });
      if (error) throw error;
      return data as any[];
    },
  });
  const { data: vaultUsers } = useQuery({
    queryKey: ["vault_users_active"],
    enabled: open,
    queryFn: async () =>
      ((await (supabase.from("vault_users" as any) as any).select("id,name").eq("is_active", true).order("name")).data ?? []) as any[],
  });

  const outstanding = useMemo(
    () => (purchases ?? []).reduce((s, x: any) => s + purchaseBalance(x), 0),
    [purchases],
  );
  const unpaid = useMemo(
    () => (purchases ?? []).filter((p: any) => purchaseBalance(p) > 0),
    [purchases],
  );

  useEffect(() => {
    if (open) {
      setTarget(presetPurchaseId ?? "fifo");
      setAmount(0);
      setMethod("cash");
      setNote("");
      setDate(new Date().toISOString().slice(0, 10));
      setVaultUserId("");
    }
  }, [open, presetPurchaseId]);

  const save = useMutation({
    mutationFn: async () => {
      await paySupplier({
        supplierId,
        amount,
        method,
        date,
        note,
        purchaseId: target === "fifo" ? undefined : target,
        vaultUserId: vaultUserId || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Payment recorded");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pay Supplier</DialogTitle>
          <DialogDescription>
            {supplierName ? `${supplierName} · ` : ""}Outstanding {formatCurrency(outstanding)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Apply to</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fifo">Oldest outstanding (FIFO)</SelectItem>
                {unpaid.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.reference_no} · {formatDate(p.purchase_date)} · due {formatCurrency(purchaseBalance(p))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" min="0" step="0.01" value={amount}
                onChange={(e) => setAmount(+e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{METHOD_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Note</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-2">
            <Label>Paid From (Vault User)</Label>
            <Select value={vaultUserId} onValueChange={setVaultUserId}>
              <SelectTrigger><SelectValue placeholder="Optional — deduct from vault balance" /></SelectTrigger>
              <SelectContent>
                {(vaultUsers ?? []).map((v: any) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {outstanding > 0 && (
            <Button type="button" variant="outline" size="sm"
              onClick={() => setAmount(Number(outstanding.toFixed(2)))}>
              Pay full outstanding ({formatCurrency(outstanding)})
            </Button>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || amount <= 0}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}