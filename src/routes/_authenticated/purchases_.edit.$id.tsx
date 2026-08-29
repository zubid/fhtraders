import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { PageHeader } from "@/components/app/PageHeader";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProductSearchPicker } from "@/components/app/ProductSearchPicker";
import { PaySupplierDialog } from "@/components/app/PaySupplierDialog";

export const Route = createFileRoute("/_authenticated/purchases_/edit/$id")({
  component: EditPurchase,
});

type Line = { product_id: string; name: string; unit: string; quantity: number; unit_price: number };

function EditPurchase() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [initialPaymentWarning, setInitialPaymentWarning] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const baseline = useRef("");

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
  });
  const { data: products } = useQuery({
    queryKey: ["products-picker"],
    queryFn: async () =>
      (await supabase.from("products").select("id,name,unit,sku,current_stock,categories(name)").order("name")).data ?? [],
  });

  const { data: purchase, isLoading } = useQuery({
    queryKey: ["purchase-edit", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("purchases")
        .select("*, purchase_items(id,product_id,quantity,unit_price,products(name,unit))")
        .eq("id", id).single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: paySplits } = useQuery({
    queryKey: ["purchase-payments", id],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_payments" as any) as any)
        .select("id,amount,method,payment_date,note,vault_user_id,vault_users(name)")
        .eq("purchase_id", id)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  useEffect(() => {
    if (!purchase) return;
    setSupplierId(purchase.supplier_id ?? "");
    setDate(purchase.purchase_date);
    setNotes(purchase.notes ?? "");
    const loadedLines = (purchase.purchase_items ?? []).map((it: any) => ({
      product_id: it.product_id, name: it.products?.name ?? "", unit: it.products?.unit ?? "",
      quantity: Number(it.quantity), unit_price: Number(it.unit_price),
    }));
    setLines(loadedLines);
    baseline.current = JSON.stringify({ supplierId: purchase.supplier_id ?? "", date: purchase.purchase_date,
      notes: purchase.notes ?? "", lines: loadedLines });
  }, [purchase]);

  useEffect(() => {
    const key = `purchase-initial-payment-warning:${id}`;
    if (sessionStorage.getItem(key)) {
      sessionStorage.removeItem(key);
      setInitialPaymentWarning(true);
    }
  }, [id]);

  const addLine = (p: { id: string; name: string; unit: string }) => {
    if (lines.some((l) => l.product_id === p.id)) return;
    setLines([...lines, { product_id: p.id, name: p.name, unit: p.unit, quantity: 1, unit_price: 0 }]);
  };
  const updateLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));
  const currentSnapshot = useMemo(() => JSON.stringify({ supplierId, date, notes, lines }), [supplierId, date, notes, lines]);
  const isDirty = !!baseline.current && currentSnapshot !== baseline.current;
  const { allowNavigation } = useUnsavedChangesGuard(isDirty);
  const grandTotal = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const storedGrandTotal = Number(purchase?.grand_total ?? 0);
  const alreadyPaid = Number(purchase?.amount_paid ?? 0);
  const balanceDue = Math.max(0, storedGrandTotal - alreadyPaid);
  const linkedPaymentTotal = (paySplits ?? []).reduce((sum: number, payment: any) => sum + Number(payment.amount), 0);
  const requiresReconciliation = linkedPaymentTotal > alreadyPaid + 0.01;
  const historicallyOverpaid = alreadyPaid > storedGrandTotal + 0.01;
  const hasPaymentHistory = (paySplits ?? []).length > 0;

  const save = useMutation({
    mutationFn: async () => {
      if (!supplierId) throw new Error("Select a supplier before updating this purchase.");
      if (!date) throw new Error("Select a purchase date before updating.");
      if (lines.length === 0) throw new Error("Add at least one product.");
      if (lines.some((line) => line.quantity <= 0)) throw new Error("Quantity must be greater than zero for every item.");
      if (lines.some((line) => line.unit_price <= 0)) throw new Error("Unit price must be greater than zero for every item.");
      if (hasPaymentHistory && supplierId !== purchase.supplier_id) throw new Error("Supplier cannot be changed after payments have been recorded.");
      if (historicallyOverpaid && grandTotal + 0.001 < storedGrandTotal) {
        throw new Error("Grand Total cannot be lower than its current value while this Purchase requires reconciliation.");
      }
      if (!historicallyOverpaid && grandTotal + 0.001 < alreadyPaid) {
        throw new Error("Grand Total cannot be lower than the amount already paid.");
      }
      // Reverse & delete existing items (triggers restock)
      const { error: dErr } = await supabase.from("purchase_items").delete().eq("purchase_id", id);
      if (dErr) throw dErr;
      // Update purchase
      const { error: uErr } = await (supabase.from("purchases") as any).update({
        supplier_id: supplierId || null,
        purchase_date: date,
        grand_total: grandTotal,
        notes: notes || null,
      }).eq("id", id);
      if (uErr) throw uErr;
      // Insert new items (triggers restock)
      const items = lines.map((l) => ({
        purchase_id: id, product_id: l.product_id,
        quantity: l.quantity, unit_price: l.unit_price, line_total: l.quantity * l.unit_price,
      }));
      const { error: iErr } = await supabase.from("purchase_items").insert(items);
      if (iErr) throw iErr;
    },
    onSuccess: () => { qc.invalidateQueries(); toast.success("Purchase updated"); allowNavigation(); navigate({ to: "/purchases" }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/purchases"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link></Button>
      <PageHeader title={`Edit Purchase ${purchase?.reference_no ?? ""}`} description="Modify items or details. Stock and payment status will be recalculated." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
          <CardContent>
            <ProductSearchPicker
              products={(products ?? []) as any}
              excludeIds={lines.map((l) => l.product_id)}
              onSelect={addLine}
            />
            <Table>
              <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>Unit Price</TableHead><TableHead className="text-right">Total</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={l.product_id}>
                    <TableCell className="font-medium">{l.name}<span className="ml-1 text-xs text-muted-foreground">({l.unit})</span></TableCell>
                    <TableCell><Input type="number" min="0" step="any" className="w-24" value={l.quantity} onChange={(e) => updateLine(i, { quantity: +e.target.value })} /></TableCell>
                    <TableCell><Input type="number" min="0" step="0.01" className="w-28" value={l.unit_price} onChange={(e) => updateLine(i, { unit_price: +e.target.value })} /></TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(l.quantity * l.unit_price)}</TableCell>
                    <TableCell><Button variant="ghost" size="icon" onClick={() => removeLine(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Supplier *</Label>
              <Select value={supplierId} onValueChange={setSupplierId} disabled={hasPaymentHistory}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>{(suppliers ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
              {hasPaymentHistory && <p className="text-xs text-muted-foreground">Supplier cannot be changed after payments have been recorded.</p>}
            </div>
            <div className="space-y-2"><Label>Purchase Date *</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-2"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="flex items-center justify-between border-t border-border pt-4 text-lg font-bold">
              <span>Grand Total</span><span>{formatCurrency(grandTotal)}</span>
            </div>
            <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Update Purchase
            </Button>
          </CardContent>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Payment Summary</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {initialPaymentWarning && (
              <div className="rounded-md border border-warning bg-warning/10 p-3 text-sm">
                <AlertTriangle className="mb-2 h-5 w-5 text-warning" />
                Purchase was saved, but one or more initial payments could not be recorded. Review the payment summary and record the remaining payment separately.
              </div>
            )}
            <div className="flex justify-between"><span>Grand Total</span><strong>{formatCurrency(storedGrandTotal)}</strong></div>
            <div className="flex justify-between"><span>Already Paid</span><strong>{formatCurrency(alreadyPaid)}</strong></div>
            <div className="flex justify-between border-t pt-3"><span>Balance Due</span><strong>{formatCurrency(balanceDue)}</strong></div>
            {requiresReconciliation && (
              <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mb-2 h-5 w-5" />
                Payment ledger requires reconciliation. Linked payment records exceed the Purchase's recorded paid amount. Do not record another payment until this Purchase is reviewed.
              </div>
            )}
            {historicallyOverpaid && (
              <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mb-2 h-5 w-5" />
                This Purchase is historically overpaid and requires reconciliation. Paid amount and payment history have not been changed.
              </div>
            )}
            {balanceDue <= 0 ? (
              <p className="text-sm text-muted-foreground">Purchase is fully paid.</p>
            ) : (
              <Button className="w-full" onClick={() => setPaymentOpen(true)} disabled={isDirty || requiresReconciliation || !supplierId}>
                Record Additional Payment
              </Button>
            )}
            {isDirty && balanceDue > 0 && <p className="text-xs text-muted-foreground">Save the Purchase changes before recording an additional payment.</p>}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Payment History</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Method</TableHead><TableHead>Paid From Vault</TableHead><TableHead>Note</TableHead></TableRow></TableHeader>
              <TableBody>
                {(paySplits ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No linked payments.</TableCell></TableRow>
                ) : (paySplits ?? []).map((payment: any) => (
                  <TableRow key={payment.id}>
                    <TableCell>{formatDate(payment.payment_date)}</TableCell>
                    <TableCell>{formatCurrency(Number(payment.amount))}</TableCell>
                    <TableCell>{payment.method}</TableCell>
                    <TableCell>{payment.vault_users?.name ?? "—"}</TableCell>
                    <TableCell>{payment.note || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      {purchase?.supplier_id && (
        <PaySupplierDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          supplierId={purchase.supplier_id}
          supplierName={(suppliers ?? []).find((supplier) => supplier.id === purchase.supplier_id)?.name}
          presetPurchaseId={id}
          lockTarget
        />
      )}
    </div>
  );
}
