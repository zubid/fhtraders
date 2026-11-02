import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Trash2, Loader2, Search, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getLastPurchasePrices } from "@/lib/last-purchase-prices";
import { ReceivePaymentDialog } from "@/components/app/ReceivePaymentDialog";
import { formatDate } from "@/lib/format";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { PageHeader } from "@/components/app/PageHeader";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/sales_/edit/$id")({
  component: EditSale,
});

type Line = { product_id: string; name: string; unit: string; quantity: number; unit_price: number; stock: number; cost: number; price_mode: "amount" | "percent"; markup_percent: number };

function EditSale() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [restaurantId, setRestaurantId] = useState("");
  const [date, setDate] = useState("");
  const [discountValue, setDiscountValue] = useState(0);
  const [discountMode, setDiscountMode] = useState<"amount" | "percent">("amount");
  const [tax, setTax] = useState(0);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [term, setTerm] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const baseline = useRef("");

  const { data: restaurants } = useQuery({
    queryKey: ["restaurants-active"],
    queryFn: async () => (await supabase.from("restaurants").select("id,name").eq("is_active", true).order("name")).data ?? [],
  });
  const { data: lastPurchasePrices = {} } = useQuery({
    queryKey: ["last-purchase-prices"],
    queryFn: getLastPurchasePrices,
  });

  const { data: products } = useQuery({
    queryKey: ["products-sale"],
    queryFn: async () => (await supabase.from("products").select("id,name,unit,sku,current_stock,avg_cost").order("name")).data ?? [],
  });

  const { data: sale, isLoading } = useQuery({
    queryKey: ["sale-edit", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales")
        .select("*, sale_items(id,product_id,quantity,unit_price,products(name,unit,current_stock,avg_cost))")
        .eq("id", id).single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: linkedPayments = [] } = useQuery({
    queryKey: ["sale-linked-payments", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("payments")
        .select("id,amount,method,payment_date,note,vault_users(name)")
        .eq("sale_id", id).order("payment_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!sale) return;
    setRestaurantId(sale.restaurant_id ?? "");
    setDate(sale.sale_date);
    setDiscountValue(Number(sale.discount) || 0);
    setTax(Number(sale.tax) || 0);
    setNotes(sale.notes ?? "");
    const loadedLines = (sale.sale_items ?? []).map((it: any) => {
      const stock = Number(it.products?.current_stock ?? 0) + Number(it.quantity);
      return { product_id: it.product_id, name: it.products?.name ?? "", unit: it.products?.unit ?? "",
        quantity: Number(it.quantity), unit_price: Number(it.unit_price), stock,
        cost: Number(lastPurchasePrices[it.product_id] ?? it.products?.avg_cost ?? 0), price_mode: "amount" as const, markup_percent: 0 };
    });
    setLines(loadedLines);
    baseline.current = JSON.stringify({ restaurantId: sale.restaurant_id ?? "", date: sale.sale_date,
      discountValue: Number(sale.discount) || 0, tax: Number(sale.tax) || 0, notes: sale.notes ?? "", lines: loadedLines });
  }, [sale, lastPurchasePrices]);

  const results = !term.trim() ? [] : (products ?? [])
    .filter((p: any) => (p.name + " " + p.sku).toLowerCase().includes(term.toLowerCase()))
    .slice(0, 8);

  const addLine = (p: any) => {
    if (lines.some((l) => l.product_id === p.id)) { setTerm(""); return; }
    setLines([...lines, { product_id: p.id, name: p.name, unit: p.unit, quantity: 1, unit_price: 0, stock: Number(p.current_stock), cost: Number(lastPurchasePrices[p.id] ?? p.avg_cost), price_mode: "amount", markup_percent: 0 }]);
    setTerm("");
  };
  const updateLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, idx) => {
    if (idx !== i) return l;
    const next = { ...l, ...patch };
    if (next.price_mode === "percent") {
      next.unit_price = Number((next.cost * (1 + (Number(next.markup_percent) || 0) / 100)).toFixed(2));
    }
    return next;
  }));
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));

  const currentSnapshot = useMemo(() => JSON.stringify({ restaurantId, date, discountValue, tax, notes, lines }), [restaurantId, date, discountValue, tax, notes, lines]);
  const { allowNavigation } = useUnsavedChangesGuard(!!baseline.current && currentSnapshot !== baseline.current);

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const discount = discountMode === "percent"
    ? Math.max(0, Math.min(100, Number(discountValue) || 0)) * subtotal / 100
    : Math.max(0, Number(discountValue) || 0);
  const grandTotal = Math.max(0, subtotal - discount + tax);
  const hasOverstock = lines.some((l) => l.quantity > l.stock);
  const receivedAmount = Number(sale?.amount_received ?? 0);
  const storedGrandTotal = Number(sale?.grand_total ?? 0);
  const balanceDue = Math.max(0, storedGrandTotal - receivedAmount);
  const isDirty = !!baseline.current && currentSnapshot !== baseline.current;
  const overpaidByEdit = grandTotal + 0.005 < receivedAmount;

  const save = useMutation({
    mutationFn: async () => {
      if (!restaurantId) throw new Error("Select a restaurant before saving this sale.");
      if (!date) throw new Error("Select a sale date before saving this sale.");
      if (lines.length === 0) throw new Error("Add at least one product.");
      if (lines.some((l) => l.quantity <= 0)) throw new Error("Quantity must be greater than zero for every item.");
      if (lines.some((l) => l.unit_price <= 0)) throw new Error("Selling price must be greater than zero for every item.");
      if (hasOverstock) throw new Error("One or more items exceed available stock.");
      if (restaurantId !== sale?.restaurant_id && receivedAmount > 0) throw new Error("Cannot change restaurant after payments have been received.");
      if (grandTotal + 0.005 < receivedAmount) throw new Error("Sale total cannot be less than amount already received. Reconcile payments first.");
      const { error: dErr } = await supabase.from("sale_items").delete().eq("sale_id", id);
      if (dErr) throw dErr;
      const { error: uErr } = await supabase.from("sales").update({
        restaurant_id: restaurantId, sale_date: date,
        subtotal, discount, tax, grand_total: grandTotal, notes: notes || null,
      }).eq("id", id);
      if (uErr) throw uErr;
      const items = lines.map((l) => ({
        sale_id: id, product_id: l.product_id,
        quantity: l.quantity, unit_price: l.unit_price, line_total: l.quantity * l.unit_price,
      }));
      const { error: iErr } = await supabase.from("sale_items").insert(items);
      if (iErr) throw iErr;
      const { data: saved } = await supabase.from("sale_items").select("quantity,cost_price").eq("sale_id", id);
      const totalCost = (saved ?? []).reduce((s, x) => s + Number(x.quantity) * Number(x.cost_price), 0);
      await supabase.from("sales").update({ total_cost: totalCost }).eq("id", id);
    },
    onSuccess: () => { qc.invalidateQueries(); toast.success("Sale updated"); allowNavigation(); navigate({ to: "/sales" }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/sales"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link></Button>
      <PageHeader title={`Edit Sale ${sale?.invoice_no ?? ""}`} description="Modify items or details. Stock will be recalculated." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
          <CardContent>
            <div className="relative mb-4 max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search product..." value={term} onChange={(e) => setTerm(e.target.value)} />
              {results.length > 0 && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                  {results.map((p: any) => (
                    <button key={p.id} type="button" onClick={() => addLine(p)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">{formatNumber(p.current_stock)} {p.unit}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Qty</TableHead><TableHead>Price</TableHead><TableHead className="text-right">Total</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {lines.map((l, i) => {
                  const over = l.quantity > l.stock;
                  const belowCost = l.cost > 0 && l.unit_price > 0 && l.unit_price < l.cost;
                  return (
                    <TableRow key={l.product_id}>
                      <TableCell className="font-medium">{l.name}<div className="text-xs text-muted-foreground">Available: {formatNumber(l.stock)} {l.unit}</div></TableCell>
                      <TableCell>
                        <Input type="number" min="0" step="any" className={`w-24 ${over ? "border-destructive" : ""}`} value={l.quantity} onChange={(e) => updateLine(i, { quantity: +e.target.value })} />
                        {over && <span className="mt-1 flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="h-3 w-3" />Exceeds</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {l.price_mode === "amount" ? (
                            <Input type="number" min="0" step="0.01" className={`w-24 ${belowCost ? "border-destructive" : ""}`} value={l.unit_price || ""} onChange={(e) => updateLine(i, { unit_price: +e.target.value })} />
                          ) : (
                            <Input type="number" min="0" step="0.01" className="w-24" placeholder="%" value={l.markup_percent || ""} onChange={(e) => updateLine(i, { markup_percent: +e.target.value })} />
                          )}
                          <Select value={l.price_mode} onValueChange={(v) => updateLine(i, { price_mode: v as any })}>
                            <SelectTrigger className="w-16 px-2"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="amount">Amt</SelectItem>
                              <SelectItem value="percent">%</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {belowCost ? <div className="mt-1 flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="h-3 w-3" />Below last purchase price: {formatCurrency(l.cost)} (allowed)</div> : l.cost > 0 && <div className="mt-1 text-xs text-muted-foreground">Last purchase: {formatCurrency(l.cost)}</div>}
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(l.quantity * l.unit_price)}</TableCell>
                      <TableCell><Button variant="ghost" size="icon" onClick={() => removeLine(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Restaurant *</Label>
              <Select value={restaurantId} onValueChange={setRestaurantId} disabled={receivedAmount > 0}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(restaurants ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Sale Date *</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-2">
              <Label>Discount</Label>
              <div className="flex gap-2">
                <Input type="number" step="0.01" min="0" value={discountValue} onChange={(e) => setDiscountValue(+e.target.value)} />
                <Select value={discountMode} onValueChange={(v) => setDiscountMode(v as any)}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="amount">Amount</SelectItem><SelectItem value="percent">%</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>Tax</Label><Input type="number" step="0.01" value={tax} onChange={(e) => setTax(+e.target.value)} /></div>
            <div className="space-y-2"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="space-y-1 border-t border-border pt-4 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
              <div className="flex justify-between"><span>Discount</span><span>-{formatCurrency(discount)}</span></div>
              <div className="flex justify-between"><span>Tax</span><span>{formatCurrency(tax)}</span></div>
              <div className="flex justify-between text-lg font-bold"><span>Grand Total</span><span>{formatCurrency(grandTotal)}</span></div>
            </div>
            {overpaidByEdit && <p className="text-sm text-destructive">New total is below the amount already received. Reconcile payments before saving.</p>}
            <p className="text-xs text-muted-foreground">Existing payments remain in the ledger. Save invoice changes before receiving additional payments.</p>
            <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending || hasOverstock || overpaidByEdit}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Update Sale
            </Button>
          </CardContent>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Payment Summary</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span>Saved Sale Total</span><strong>{formatCurrency(storedGrandTotal)}</strong></div>
            <div className="flex justify-between"><span>Already Received</span><strong>{formatCurrency(receivedAmount)}</strong></div>
            <div className="flex justify-between border-t pt-3"><span>Balance Due</span><strong>{formatCurrency(balanceDue)}</strong></div>
            {balanceDue <= 0 ? <p className="text-muted-foreground">Sale is fully paid.</p> :
              <Button className="w-full" onClick={() => setPaymentOpen(true)} disabled={isDirty || save.isPending || !sale?.restaurant_id}>
                Receive Additional Payment
              </Button>}
            {isDirty && balanceDue > 0 && <p className="text-xs text-muted-foreground">Save sale changes before receiving payment.</p>}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Payment History</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Amount</TableHead><TableHead>Method</TableHead><TableHead>Received By</TableHead><TableHead>Note</TableHead></TableRow></TableHeader>
              <TableBody>
                {linkedPayments.length === 0 ?
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No directly linked payment records.</TableCell></TableRow> :
                  linkedPayments.map((payment: any) =>
                    <TableRow key={payment.id}>
                      <TableCell>{formatDate(payment.payment_date)}</TableCell>
                      <TableCell>{formatCurrency(Number(payment.amount))}</TableCell>
                      <TableCell>{payment.method}</TableCell>
                      <TableCell>{payment.vault_users?.name ?? "—"}</TableCell>
                      <TableCell>{payment.note || "—"}</TableCell>
                    </TableRow>)}
              </TableBody>
            </Table>
            <p className="mt-2 text-xs text-muted-foreground">Restaurant payments allocated by FIFO may contribute to received totals without being directly linked to this invoice.</p>
          </CardContent>
        </Card>
      </div>
      {!!sale?.restaurant_id && (
        <ReceivePaymentDialog open={paymentOpen} onOpenChange={setPaymentOpen}
          restaurantId={sale.restaurant_id}
          restaurantName={(restaurants ?? []).find((r) => r.id === sale.restaurant_id)?.name}
          presetSaleId={id} />
      )}
    </div>
  );
}
