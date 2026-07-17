import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
  const [vaultUserId, setVaultUserId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [pickProduct, setPickProduct] = useState("");

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
  });
  const { data: vaultUsers } = useQuery({
    queryKey: ["vault_users_active"],
    queryFn: async () => ((await (supabase.from("vault_users" as any) as any).select("id,name").eq("is_active", true).order("name")).data ?? []) as any[],
  });
  const { data: products } = useQuery({
    queryKey: ["products-min"],
    queryFn: async () => (await supabase.from("products").select("id,name,unit").order("name")).data ?? [],
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

  useEffect(() => {
    if (!purchase) return;
    setSupplierId(purchase.supplier_id ?? "");
    setDate(purchase.purchase_date);
    setNotes(purchase.notes ?? "");
    setVaultUserId(purchase.vault_user_id ?? "");
    setLines((purchase.purchase_items ?? []).map((it: any) => ({
      product_id: it.product_id, name: it.products?.name ?? "", unit: it.products?.unit ?? "",
      quantity: Number(it.quantity), unit_price: Number(it.unit_price),
    })));
  }, [purchase]);

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
      // Reverse & delete existing items (triggers restock)
      const { error: dErr } = await supabase.from("purchase_items").delete().eq("purchase_id", id);
      if (dErr) throw dErr;
      // Update purchase
      const { error: uErr } = await (supabase.from("purchases") as any).update({
        supplier_id: supplierId || null,
        purchase_date: date,
        grand_total: grandTotal,
        notes: notes || null,
        vault_user_id: vaultUserId || null,
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
    onSuccess: () => { qc.invalidateQueries(); toast.success("Purchase updated"); navigate({ to: "/purchases" }); },
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
              <Label>Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>{(suppliers ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Purchase Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-2"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="space-y-2">
              <Label>Paid By (Vault User)</Label>
              <Select value={vaultUserId} onValueChange={setVaultUserId}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>{(vaultUsers ?? []).map((v: any) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-4 text-lg font-bold">
              <span>Grand Total</span><span>{formatCurrency(grandTotal)}</span>
            </div>
            <p className="text-xs text-muted-foreground">Payments already recorded stay linked. Balance recalculates automatically.</p>
            <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Update Purchase
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
