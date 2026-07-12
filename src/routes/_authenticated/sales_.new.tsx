import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Trash2, Loader2, Search, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/sales_/new")({
  component: NewSale,
});

type Line = { product_id: string; name: string; unit: string; quantity: number; unit_price: number; stock: number };

function NewSale() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [restaurantId, setRestaurantId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [discount, setDiscount] = useState(0);
  const [tax, setTax] = useState(0);
  const [notes, setNotes] = useState("");
  const [received, setReceived] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [term, setTerm] = useState("");

  const { data: restaurants } = useQuery({
    queryKey: ["restaurants-active"],
    queryFn: async () => (await supabase.from("restaurants").select("id,name").eq("is_active", true).order("name")).data ?? [],
  });
  const { data: products } = useQuery({
    queryKey: ["products-sale"],
    queryFn: async () =>
      (await supabase.from("products").select("id,name,unit,sku,current_stock,default_selling_price,categories(name)").order("name")).data ?? [],
  });

  const results = useMemo(() => {
    if (!term.trim()) return [];
    const s = term.toLowerCase();
    return (products ?? [])
      .filter((p: any) =>
        p.name.toLowerCase().includes(s) ||
        p.sku.toLowerCase().includes(s) ||
        (p.categories?.name ?? "").toLowerCase().includes(s),
      )
      .slice(0, 8);
  }, [products, term]);

  const addLine = (p: any) => {
    if (lines.some((l) => l.product_id === p.id)) { setTerm(""); return; }
    setLines([...lines, { product_id: p.id, name: p.name, unit: p.unit, quantity: 1, unit_price: Number(p.default_selling_price), stock: Number(p.current_stock) }]);
    setTerm("");
  };
  const updateLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const grandTotal = Math.max(0, subtotal - discount + tax);
  const hasOverstock = lines.some((l) => l.quantity > l.stock);

  const save = useMutation({
    mutationFn: async () => {
      if (lines.length === 0) throw new Error("Add at least one product");
      if (!restaurantId) throw new Error("Select a restaurant");
      if (hasOverstock) throw new Error("One or more items exceed available stock");
      const { data: sale, error: sErr } = await supabase
        .from("sales")
        .insert({ restaurant_id: restaurantId, sale_date: date, subtotal, discount, tax, grand_total: grandTotal, amount_received: Math.min(received, grandTotal), notes: notes || null })
        .select("id").single();
      if (sErr) throw sErr;
      const items = lines.map((l) => ({
        sale_id: sale.id, product_id: l.product_id,
        quantity: l.quantity, unit_price: l.unit_price, line_total: l.quantity * l.unit_price,
      }));
      const { error: iErr } = await supabase.from("sale_items").insert(items);
      if (iErr) throw iErr;
      // capture cost total from sale_items after triggers set cost_price
      const { data: saved } = await supabase.from("sale_items").select("quantity,cost_price").eq("sale_id", sale.id);
      const totalCost = (saved ?? []).reduce((s, x) => s + Number(x.quantity) * Number(x.cost_price), 0);
      await supabase.from("sales").update({ total_cost: totalCost }).eq("id", sale.id);
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Sale saved · stock deducted");
      navigate({ to: "/sales" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/sales"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link></Button>
      <PageHeader title="New Sale" description="Record a stock-out transaction" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
          <CardContent>
            <div className="relative mb-4 max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search product by name, SKU or category..." value={term} onChange={(e) => setTerm(e.target.value)} />
              {results.length > 0 && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                  {results.map((p: any) => (
                    <button key={p.id} type="button" onClick={() => addLine(p)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground">
                      <span><span className="font-medium">{p.name}</span><span className="ml-2 text-xs text-muted-foreground">{p.sku} · {p.categories?.name ?? ""}</span></span>
                      <span className={`text-xs ${Number(p.current_stock) <= 0 ? "text-destructive" : "text-muted-foreground"}`}>{formatNumber(p.current_stock)} {p.unit}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {lines.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">Search and add products above.</div>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>Price</TableHead><TableHead className="text-right">Total</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {lines.map((l, i) => {
                    const over = l.quantity > l.stock;
                    return (
                      <TableRow key={l.product_id}>
                        <TableCell className="font-medium">{l.name}<div className="text-xs text-muted-foreground">Available: {formatNumber(l.stock)} {l.unit}</div></TableCell>
                        <TableCell>
                          <Input type="number" min="0" step="any" className={`w-24 ${over ? "border-destructive" : ""}`} value={l.quantity} onChange={(e) => updateLine(i, { quantity: +e.target.value })} />
                          {over && <span className="mt-1 flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="h-3 w-3" />Exceeds stock</span>}
                        </TableCell>
                        <TableCell><Input type="number" min="0" step="0.01" className="w-28" value={l.unit_price} onChange={(e) => updateLine(i, { unit_price: +e.target.value })} /></TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(l.quantity * l.unit_price)}</TableCell>
                        <TableCell><Button variant="ghost" size="icon" onClick={() => removeLine(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Restaurant</Label>
              <Select value={restaurantId} onValueChange={setRestaurantId}>
                <SelectTrigger><SelectValue placeholder="Select restaurant" /></SelectTrigger>
                <SelectContent>{(restaurants ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Sale Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2"><Label>Discount</Label><Input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(+e.target.value)} /></div>
              <div className="space-y-2"><Label>Tax</Label><Input type="number" step="0.01" value={tax} onChange={(e) => setTax(+e.target.value)} /></div>
            </div>
            <div className="space-y-2"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="space-y-1 border-t border-border pt-4 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
              <div className="flex justify-between"><span>Discount</span><span>-{formatCurrency(discount)}</span></div>
              <div className="flex justify-between"><span>Tax</span><span>{formatCurrency(tax)}</span></div>
              <div className="flex justify-between text-lg font-bold"><span>Grand Total</span><span>{formatCurrency(grandTotal)}</span></div>
            </div>
            <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending || hasOverstock}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Sale
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}