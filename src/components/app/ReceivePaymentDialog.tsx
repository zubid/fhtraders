import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { recordPayment, saleBalance, PAYMENT_METHODS, METHOD_LABELS } from "@/lib/credit";
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

export function ReceivePaymentDialog({
  open,
  onOpenChange,
  restaurantId,
  restaurantName,
  presetSaleId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  restaurantId: string;
  restaurantName?: string;
  presetSaleId?: string;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState<string>("cash");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [target, setTarget] = useState<string>("fifo");

  const { data: sales } = useQuery({
    queryKey: ["unpaid-sales", restaurantId],
    enabled: open && !!restaurantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id, invoice_no, grand_total, amount_received, sale_date, payment_status")
        .eq("restaurant_id", restaurantId)
        .order("sale_date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const outstanding = useMemo(
    () => (sales ?? []).reduce((s, x) => s + saleBalance(x), 0),
    [sales],
  );
  const unpaidSales = useMemo(
    () => (sales ?? []).filter((s) => saleBalance(s) > 0),
    [sales],
  );

  useEffect(() => {
    if (open) {
      setTarget(presetSaleId ?? "fifo");
      setAmount(0);
      setMethod("cash");
      setNote("");
      setDate(new Date().toISOString().slice(0, 10));
    }
  }, [open, presetSaleId]);

  const save = useMutation({
    mutationFn: async () => {
      await recordPayment({
        restaurantId,
        amount,
        method,
        date,
        note,
        saleId: target === "fifo" ? undefined : target,
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
          <DialogTitle>Receive Payment</DialogTitle>
          <DialogDescription>
            {restaurantName ? `${restaurantName} · ` : ""}Outstanding {formatCurrency(outstanding)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Apply to</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fifo">Oldest outstanding (FIFO)</SelectItem>
                {unpaidSales.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.invoice_no} · {formatDate(s.sale_date)} · due {formatCurrency(saleBalance(s))}
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
