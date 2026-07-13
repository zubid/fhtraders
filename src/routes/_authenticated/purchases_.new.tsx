import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
  const [pickProduct, setPickProduct] = useState("");

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
  });
  const { data: products } = useQuery({
    queryKey: ["products-min"],
    queryFn: async () => (await supabase.from("products").select("id,name,unit").order("name")).data ?? [],
  });

  const addLine = (pid: string) => {
    const p = (products ?? []).find((x) => x.id === pid);
    if (!p || lines.some((l) => l.product_id === pid)) return;
    setLines([...lines, { product_id: p.id, name: p.name, unit: p.unit, quantity: 1, unit_price: 0 }]);
    setPickProduct("");
  };
  const updateLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));

  const grandTotal = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);

  const save = useMutation({
    mutationFn: async () => {
      if (lines.length === 0) throw new Error("Add at least one product");
      let sid = supplierId || null;
      if (!sid && newSupplier.trim()) {
        const { data, error } = await supabase.from("suppliers").insert({ name: newSupplier.trim() }).select("id").single();
        if (error) throw error;
        sid = data.id;
      }
      const { data: purchase, error: pErr } = await supabase
        .from("purchases")
        .insert({ supplier_id: sid, purchase_date: date, grand_total: grandTotal, notes: notes || null })
        .select("id").single();
      if (pErr) throw pErr;
      const items = lines.map((l) => ({
        purchase_id: purchase.id, product_id: l.product_id,
        quantity: l.quantity, unit_price: l.unit_price, line_total: l.quantity * l.unit_price,
      }));
      const { error: iErr } = await supabase.from("purchase_items").insert(items);
      if (iErr) throw iErr;
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Purchase saved · stock updated");
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
            <div className="mb-4 max-w-sm">
              <Label className="mb-1 block">Add product</Label>
              <Select value={pickProduct} onValueChange={addLine}>
                <SelectTrigger><SelectValue placeholder="Select a product..." /></SelectTrigger>
                <SelectContent>
                  {(products ?? []).filter((p) => !lines.some((l) => l.product_id === p.id)).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              <Label>Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>{(suppliers ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
              {!supplierId && <Input placeholder="or type a new supplier name" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} />}
            </div>
            <div className="space-y-2"><Label>Purchase Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-2"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="flex items-center justify-between border-t border-border pt-4 text-lg font-bold">
              <span>Grand Total</span><span>{formatCurrency(grandTotal)}</span>
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