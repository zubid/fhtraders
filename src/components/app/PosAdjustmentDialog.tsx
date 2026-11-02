import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Mode = "item_less" | "delete" | "edit";

/** Turns backend errors into messages a cashier can act on. */
export function posErrorMessage(e: any): string {
  const m = String(e?.message ?? e ?? "Something went wrong");
  if (/not configured/i.test(m)) return "No POS authorization password is set yet. An admin must set it in Settings → Security first.";
  if (/Incorrect authorization/i.test(m)) return "Incorrect authorization password. Please try again.";
  if (/Not authorized/i.test(m)) return "Your account is not allowed to change POS invoices. Please sign in again or ask an admin.";
  if (/already deleted|not found/i.test(m)) return "This invoice was already deleted or no longer exists. Refresh the list.";
  return m;
}

export function PosAdjustmentDialog({ open, onOpenChange, sale, mode }: { open: boolean; onOpenChange: (v: boolean) => void; sale: any; mode: Mode }) {
  const qc = useQueryClient();
  const [product, setProduct] = useState("");
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [customer, setCustomer] = useState("");
  const [discount, setDiscount] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const submitting = useRef(false);

  // Reset every field whenever the invoice or the mode changes, or the dialog reopens.
  useEffect(() => {
    if (!open || !sale) return;
    setItems((sale.sale_items ?? []).map((i: any) => ({ product_id: i.product_id, quantity: Number(i.quantity), unit_price: Number(i.unit_price), name: i.products?.name ?? "Item" })));
    setCustomer(sale.customer_name ?? "");
    setDiscount(Number(sale.discount ?? 0));
    setProduct(""); setQty(1); setReason(""); setPassword(""); setConfirmDelete(false); setErrorMsg("");
    submitting.current = false;
  }, [open, sale?.id, mode]);

  const save = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error("Please enter a reason for this change.");
      if (!password) throw new Error("Please enter the authorization password.");
      if (mode === "delete" && !confirmDelete) throw new Error("Please tick the confirmation box to delete this sale.");
      if (mode === "edit" && (!items.length || items.some((i) => !(i.quantity > 0) || !(i.unit_price >= 0)))) throw new Error("Every line needs a quantity above 0 and a price of 0 or more.");
      if (mode === "item_less" && (!product || !(qty > 0))) throw new Error("Choose an item and a quantity above 0.");
      const rpc = supabase.rpc as any;
      const { error } = mode === "edit"
        ? await rpc("pos_edit_sale", { p_sale_id: sale.id, p_items: items.map(({ product_id, quantity, unit_price }) => ({ product_id, quantity, unit_price })), p_customer_name: customer, p_discount: discount, p_reason: reason.trim(), p_password: password })
        : mode === "delete"
          ? await rpc("void_pos_sale", { p_sale_id: sale.id, p_reason: reason.trim(), p_password: password })
          : await rpc("pos_item_less", { p_sale_id: sale.id, p_product_id: product, p_quantity: qty, p_reason: reason.trim(), p_password: password });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(mode === "delete" ? "POS sale deleted. Stock restored and history kept." : mode === "edit" ? "Invoice updated" : "Item less recorded");
      qc.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e: any) => { const m = posErrorMessage(e); setErrorMsg(m); toast.error(m); },
    onSettled: () => { submitting.current = false; },
  });

  const submit = () => {
    if (submitting.current || save.isPending) return;
    submitting.current = true;
    setErrorMsg("");
    save.mutate();
  };

  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!save.isPending) onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{mode === "delete" ? "Delete POS Sale" : mode === "edit" ? "Edit POS Invoice" : "Item Less"} · {sale?.invoice_no}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {mode === "edit" && (
            <div className="space-y-2">
              <Label>Invoice items (quantity · unit price)</Label>
              {items.map((i, index) => (
                <div key={i.product_id} className="grid grid-cols-[1fr_85px_105px] items-center gap-2">
                  <span className="text-sm">{i.name}</span>
                  <Input aria-label="Quantity" type="number" min="0.001" step="any" value={i.quantity} onChange={(e) => setItems((a) => a.map((x, j) => (j === index ? { ...x, quantity: Number(e.target.value) } : x)))} />
                  <Input aria-label="Unit price" type="number" min="0" step="any" value={i.unit_price} onChange={(e) => setItems((a) => a.map((x, j) => (j === index ? { ...x, unit_price: Number(e.target.value) } : x)))} />
                </div>
              ))}
              <p className="text-xs text-muted-foreground">Subtotal {subtotal.toFixed(2)} · Total {(subtotal - (discount || 0)).toFixed(2)}</p>
              <Label>Customer</Label>
              <Input value={customer} onChange={(e) => setCustomer(e.target.value)} />
              <Label>Discount</Label>
              <Input type="number" min="0" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
            </div>
          )}
          {mode === "item_less" && (
            <>
              <div><Label>Item</Label><Select value={product} onValueChange={setProduct}><SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger><SelectContent>{(sale?.sale_items ?? []).map((i: any) => <SelectItem key={i.product_id} value={i.product_id}>{i.products?.name} · Qty {i.quantity}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Quantity to remove</Label><Input type="number" min={0.001} value={qty} onChange={(e) => setQty(Number(e.target.value))} /></div>
            </>
          )}
          {mode === "delete" && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p>The invoice is kept in history as deleted. All its items go back to stock and its payment is removed from the vault.</p>
              <label className="mt-2 flex items-center gap-2 font-medium"><Checkbox checked={confirmDelete} onCheckedChange={(v) => setConfirmDelete(v === true)} />I confirm I want to delete {sale?.invoice_no}</label>
            </div>
          )}
          <div><Label>Reason</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required audit reason" /></div>
          <div><Label>Authorization Password</Label><Input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password set in Settings → Security" /></div>
          {errorMsg && <p role="alert" className="text-sm text-destructive">{errorMsg}</p>}
          <Button variant={mode === "delete" ? "destructive" : "default"} className="w-full" onClick={submit}
            disabled={save.isPending || !reason.trim() || !password || (mode === "item_less" && !product) || (mode === "delete" && !confirmDelete)}>
            {save.isPending ? "Saving…" : mode === "delete" ? "Delete & Restore Stock" : mode === "edit" ? "Save Authorized Changes" : "Apply Item Less"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
