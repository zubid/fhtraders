import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { PageHeader } from "@/components/app/PageHeader";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PAYMENT_METHODS, METHOD_LABELS } from "@/lib/supplier-credit";
import { ProductSearchPicker } from "@/components/app/ProductSearchPicker";

export const Route = createFileRoute("/_authenticated/purchases_/new")({
  component: NewPurchase,
});

type Line = { product_id: string; name: string; unit: string; quantity: number; unit_price: number };

function NewPurchase() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [splits, setSplits] = useState<{ vault_user_id: string; amount: number; method: string }[]>([]);
  const defaultDate = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const isDirty = !!supplierId || !!newSupplier.trim() || lines.length > 0 || splits.length > 0 || !!notes.trim() || date !== defaultDate;
  const { allowNavigation } = useUnsavedChangesGuard(isDirty);

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
  });
  const { data: vaultUsers } = useQuery({
    queryKey: ["vault_users_active"],
    queryFn: async () =>
      ((await (supabase.from("vault_users" as any) as any).select("id,name").eq("is_active", true).eq("vault_type", "business_cash").order("name")).data ?? []) as any[],
  });
  const { data: products } = useQuery({
    queryKey: ["products-picker"],
    queryFn: async () =>
      (await supabase.from("products").select("id,name,unit,sku,current_stock,categories(name)").order("name")).data ?? [],
  });

  const addLine = (p: { id: string; name: string; unit: string }) => {
    if (lines.some((l) => l.product_id === p.id)) return;
    setLines([...lines, { product_id: p.id, name: p.name, unit: p.unit, quantity: 1, unit_price: 0 }]);
  };
  const updateLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));

  const grandTotal = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const amountPaid = splits.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const balanceDue = Math.max(0, grandTotal - amountPaid);

  const addSplit = () =>
    setSplits([...splits, { vault_user_id: "", amount: Number(balanceDue.toFixed(2)), method: "cash" }]);
  const updateSplit = (i: number, patch: Partial<{ vault_user_id: string; amount: number; method: string }>) =>
    setSplits(splits.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const removeSplit = (i: number) => setSplits(splits.filter((_, idx) => idx !== i));

  const save = useMutation({
    mutationFn: async () => {
      if (!supplierId && !newSupplier.trim()) throw new Error("Select a supplier or enter a new supplier name.");
      if (!date) throw new Error("Select a purchase date before saving.");
      if (lines.length === 0) throw new Error("Add at least one product.");
      if (lines.some((line) => line.quantity <= 0)) throw new Error("Quantity must be greater than zero for every item.");
      if (lines.some((line) => line.unit_price <= 0)) throw new Error("Unit price must be greater than zero for every item.");
      const activeSplits = splits.filter((s) => Number(s.amount) > 0);
      if (activeSplits.some((split) => !split.vault_user_id)) throw new Error("Select the Vault User that paid this amount.");
      if (activeSplits.some((split) => !split.method)) throw new Error("Select a Payment Method for every payment.");
      const paidNow = activeSplits.reduce((s, p) => s + Number(p.amount), 0);
      if (paidNow > grandTotal + 0.001) throw new Error("Paid amount cannot exceed the grand total");
      let sid = supplierId || null;
      if (!sid && newSupplier.trim()) {
        const { data, error } = await supabase.from("suppliers").insert({ name: newSupplier.trim() }).select("id").single();
        if (error) throw error;
        sid = data.id;
      }
      if (paidNow > 0 && !sid) throw new Error("Select or enter a supplier to record a payment");
      const { data: purchase, error: pErr } = await supabase
        .from("purchases")
        .insert({
          supplier_id: sid, purchase_date: date, grand_total: grandTotal, notes: notes || null,
          amount_paid: paidNow, vault_user_id: activeSplits.find((s) => s.vault_user_id)?.vault_user_id || null,
        } as any)
        .select("id").single();
      if (pErr) throw pErr;
      const items = lines.map((l) => ({
        purchase_id: purchase.id, product_id: l.product_id,
        quantity: l.quantity, unit_price: l.unit_price, line_total: l.quantity * l.unit_price,
      }));
      const { error: iErr } = await supabase.from("purchase_items").insert(items);
      if (iErr) throw iErr;
      if (activeSplits.length > 0 && sid) {
        const { data: userData } = await supabase.auth.getUser();
        const { error: spErr } = await (supabase.from("supplier_payments" as any) as any).insert(
          activeSplits.map((s) => ({
            supplier_id: sid,
            purchase_id: purchase.id,
            amount: Number(s.amount),
            method: s.method,
            payment_date: date,
            note: "Paid at purchase",
            vault_user_id: s.vault_user_id || null,
            created_by: userData.user?.id ?? null,
          })),
        );
        if (spErr) throw spErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Purchase saved · stock updated");
      allowNavigation();
      navigate({ to: "/purchases" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/purchases"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link></Button>
      <PageHeader title="New Purchase" description="Record a stock-in transaction" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
          <CardContent>
            <ProductSearchPicker
              products={(products ?? []) as any}
              excludeIds={lines.map((l) => l.product_id)}
              onSelect={addLine}
            />
            {lines.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">No items added yet.</div>
            ) : (
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
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Supplier *</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>{(suppliers ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
              {!supplierId && <Input placeholder="or type a new supplier name" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} />}
            </div>
            <div className="space-y-2"><Label>Purchase Date *</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-2"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="flex items-center justify-between border-t border-border pt-4 text-lg font-bold">
              <span>Grand Total</span><span>{formatCurrency(grandTotal)}</span>
            </div>
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <Label>Payments (split by vault user)</Label>
                <Button type="button" variant="outline" size="sm" onClick={addSplit}>
                  <Plus className="mr-1 h-3.5 w-3.5" />Add
                </Button>
              </div>
              {splits.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nothing paid yet — the full amount stays as a supplier balance. Add one or more payments to split the bill
                  between vault users (e.g. half by one, half by another).
                </p>
              )}
              {splits.map((s, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <Input type="number" min="0" step="0.01" value={s.amount}
                      onChange={(e) => updateSplit(i, { amount: +e.target.value })} placeholder="0.00" />
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeSplit(i)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <Select value={s.vault_user_id} onValueChange={(v) => updateSplit(i, { vault_user_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Paid by (vault user)" /></SelectTrigger>
                    <SelectContent>
                      {(vaultUsers ?? []).map((v: any) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={s.method} onValueChange={(v) => updateSplit(i, { method: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{METHOD_LABELS[m]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              <div className="flex justify-between text-sm"><span>Total Paid</span><span className="font-medium text-success">{formatCurrency(amountPaid)}</span></div>
              <div className="flex justify-between text-sm"><span>Balance Due</span><span className="font-medium">{formatCurrency(balanceDue)}</span></div>
              <p className="text-xs text-muted-foreground">Remaining balance can be paid later from the Suppliers page.</p>
            </div>
            <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Purchase
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}