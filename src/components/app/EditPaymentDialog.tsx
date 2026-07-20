import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { updatePayment, PAYMENT_METHODS, METHOD_LABELS } from "@/lib/credit";
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
  } | null;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState<string>("cash");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open && payment) {
      setAmount(Number(payment.amount));
      setMethod(payment.method);
      setDate(payment.payment_date);
      setNote(payment.note ?? "");
    }
  }, [open, payment]);

  const save = useMutation({
    mutationFn: async () => {
      if (!payment) return;
      await updatePayment(payment.id, payment.restaurant_id, { amount, method, date, note });
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
            Changing the amount, date, or method will automatically recalculate this
            restaurant's invoice balances.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || amount <= 0}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
