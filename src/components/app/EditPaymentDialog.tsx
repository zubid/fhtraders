import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { updatePayment, PAYMENT_METHODS, METHOD_LABELS } from "@/lib/credit";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function EditPaymentDialog({
  open,
  onOpenChange,
  payment,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  payment: {
    id: string;
    restaurant_id: string;
    amount: number;
    method: string;
    payment_date: string;
    note?: string | null;
    vault_user_id?: string | null;
    sale_id?: string | null;
  } | null;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState<string>("cash");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [vaultUserId, setVaultUserId] = useState<string>("none");
  const [target, setTarget] = useState("fifo");

  const { data: sales } = useQuery({
    queryKey: ["payment-target-sales", payment?.restaurant_id],
    enabled: open && !!payment,
    queryFn: async () =>
      ((
        await supabase
          .from("sales")
          .select("id,invoice_no,sale_date")
          .eq("restaurant_id", payment!.restaurant_id)
          .order("sale_date")
      ).data ?? []) as any[],
  });

  const { data: vaultUsers } = useQuery({
    queryKey: ["vault_users_active"],
    queryFn: async () =>
      ((
        await (supabase.from("vault_users" as any) as any)
          .select("id,name")
          .eq("is_active", true)
          .order("name")
      ).data ?? []) as any[],
  });

  useEffect(() => {
    if (open && payment) {
      setAmount(Number(payment.amount));
      setMethod(payment.method);
      setDate(payment.payment_date);
      setNote(payment.note ?? "");
      setVaultUserId(payment.vault_user_id ?? "none");
      setTarget(payment.sale_id ?? "fifo");
    }
  }, [open, payment]);

  const save = useMutation({
    mutationFn: async () => {
      if (!payment) return;
      await updatePayment(payment.id, payment.restaurant_id, {
        amount,
        method,
        date,
        note,
        vaultUserId: vaultUserId === "none" ? null : vaultUserId,
        saleId: target === "fifo" ? null : target,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Payment updated");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Payment</DialogTitle>
          <DialogDescription>
            Changing the amount, date, or method will automatically recalculate this restaurant's
            invoice balances.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Apply To</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fifo">Oldest outstanding (FIFO)</SelectItem>
                {(sales ?? []).map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.invoice_no} · {s.sale_date}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(+e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {METHOD_LABELS[m]}
                    </SelectItem>
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
            <Label>Received By (Vault User)</Label>
            <Select value={vaultUserId} onValueChange={setVaultUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Select vault user" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No vault user</SelectItem>
                {(vaultUsers ?? []).map((v: any) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Note</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || amount <= 0}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
