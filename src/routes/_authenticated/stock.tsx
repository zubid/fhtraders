import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, History, Download, Coins, ShoppingCart, Receipt, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { StockBadge } from "@/components/app/StockBadge";
import { formatNumber, formatDate, formatCurrency, stockStatus, downloadCSV } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/stock")({
  component: StockPage,
});

function StockPage() {
  const [ledgerProduct, setLedgerProduct] = useState<any>(null);

  const { data: products, isLoading } = useQuery({
    queryKey: ["stock-products"],
    queryFn: async () =>
      (await supabase.from("products").select("*, categories(name,color)").order("name")).data ?? [],
  });

  const grouped = useMemo(() => {
    const map = new Map<string, { color: string; items: any[] }>();
    (products ?? []).forEach((p: any) => {
      const name = p.categories?.name ?? "Uncategorized";
      if (!map.has(name)) map.set(name, { color: p.categories?.color ?? "#94a3b8", items: [] });
      map.get(name)!.items.push(p);
    });
    return [...map.entries()];
  }, [products]);

  const stockValue = (p: any) => Number(p.current_stock ?? 0) * Number(p.avg_cost ?? 0);
  const totalValue = (products ?? []).reduce((s: number, p: any) => s + stockValue(p), 0);
  const totalUnits = (products ?? []).reduce((s: number, p: any) => s + Number(p.current_stock ?? 0), 0);

  const lowStock = (products ?? []).filter((p: any) => {
    const st = stockStatus(p.current_stock, p.reorder_level, p.max_stock_level);
    return st === "low" || st === "out";
  });

  const exportCSV = () => {
    const rows: (string | number)[][] = [["Product", "SKU", "Category", "Stock", "Unit", "Avg Cost", "Stock Value", "Reorder", "Max"]];
    (products ?? []).forEach((p: any) =>
      rows.push([
        p.name, p.sku, p.categories?.name ?? "", p.current_stock, p.unit,
        Number(p.avg_cost ?? 0).toFixed(2), stockValue(p).toFixed(2),
        p.reorder_level, p.max_stock_level,
      ]),
    );
    rows.push(["", "", "", "", "", "TOTAL", totalValue.toFixed(2), "", ""]);
    downloadCSV("stock.csv", rows);
  };

  return (
    <div>
      <PageHeader
        title="Stock & Inventory"
        description="Live stock levels grouped by category"
        actions={<Button variant="outline" onClick={exportCSV}><Download className="mr-1 h-4 w-4" />Export CSV</Button>}
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Products</p><p className="mt-1 text-2xl font-bold">{(products ?? []).length}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Units in Stock</p><p className="mt-1 text-2xl font-bold">{formatNumber(totalUnits)}</p></CardContent></Card>
        <Card>
          <CardContent className="flex items-center justify-between pt-6">
            <div>
              <p className="text-sm text-muted-foreground">Total Stock Value</p>
              <p className="mt-1 text-2xl font-bold text-primary">{formatCurrency(totalValue)}</p>
            </div>
            <Coins className="h-8 w-8 text-primary" />
          </CardContent>
        </Card>
      </div>

      {lowStock.length > 0 && (
        <Card className="mb-4 border-warning/40 bg-warning/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-warning-foreground"><AlertTriangle className="h-4 w-4 text-warning" />Low Stock Alerts ({lowStock.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {lowStock.map((p: any) => (
              <Badge key={p.id} variant="outline" className="border-warning/40">
                {p.name}: {formatNumber(p.current_stock)} {p.unit}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([cat, { color, items }]) => {
            const catValue = items.reduce((s: number, p: any) => s + stockValue(p), 0);
            return (
            <Card key={cat}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />{cat}
                  <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
                  <span className="ml-auto text-sm font-semibold text-primary">{formatCurrency(catValue)}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead><TableHead className="text-right">Current</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead><TableHead className="text-right">Stock Value</TableHead>
                        <TableHead className="text-right">Reorder</TableHead><TableHead className="text-right">Max</TableHead>
                        <TableHead>Status</TableHead><TableHead className="text-right">Ledger</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((p: any) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell className="text-right">{formatNumber(p.current_stock)} {p.unit}</TableCell>
                          <TableCell className="text-right">{formatCurrency(p.avg_cost)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(stockValue(p))}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{formatNumber(p.reorder_level)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{formatNumber(p.max_stock_level)}</TableCell>
                          <TableCell><StockBadge current={p.current_stock} reorder={p.reorder_level} max={p.max_stock_level} /></TableCell>
                          <TableCell className="text-right"><Button variant="ghost" size="icon" onClick={() => setLedgerProduct(p)}><History className="h-4 w-4" /></Button></TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/30 font-semibold">
                        <TableCell colSpan={3} className="text-right">Category Total</TableCell>
                        <TableCell className="text-right text-primary">{formatCurrency(catValue)}</TableCell>
                        <TableCell colSpan={4} />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      <LedgerDialog product={ledgerProduct} onClose={() => setLedgerProduct(null)} />
    </div>
  );
}

function LedgerDialog({ product, onClose }: { product: any; onClose: () => void }) {
  const { data: movements, isLoading } = useQuery({
    queryKey: ["movements", product?.id],
    enabled: !!product,
    queryFn: async () =>
      (await supabase.from("stock_movements").select("*").eq("product_id", product.id).order("created_at", { ascending: false }).limit(200)).data ?? [],
  });

  const refs=(movements??[]).filter((m:any)=>m.reference_id).map((m:any)=>m.reference_id);
  const {data: purchaseLines}=useQuery({queryKey:["ledger-purchase-prices",product?.id,refs.join(",")],enabled:!!product&&refs.length>0,queryFn:async()=>((await supabase.from("purchase_items").select("purchase_id,unit_price,line_total,purchases(reference_no,purchase_date,suppliers(name))").eq("product_id",product.id).in("purchase_id",refs)).data??[]) as any[]});
  const { data: recentPurchases = [], isLoading: pricesLoading, error: pricesError } = useQuery({
    queryKey: ["ledger-price-history", product?.id],
    enabled: !!product,
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_items")
        .select("id,purchase_id,quantity,unit_price,line_total,purchases(reference_no,purchase_date,created_at,suppliers(name))")
        .eq("product_id", product.id).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []).sort((a: any, b: any) =>
        String(b.purchases?.purchase_date ?? "").localeCompare(String(a.purchases?.purchase_date ?? "")) ||
        String(b.purchases?.created_at ?? "").localeCompare(String(a.purchases?.created_at ?? "")));
    },
  });
  const priceRows = recentPurchases.filter((p: any) => Number.isFinite(Number(p.unit_price)));
  const priceValues = priceRows.map((p: any) => Number(p.unit_price));
  const lowest = priceValues.length ? Math.min(...priceValues) : null;
  const highest = priceValues.length ? Math.max(...priceValues) : null;
  const chartData = [...priceRows].reverse().map((p: any) => ({
    date: p.purchases?.purchase_date ?? "",
    price: Number(p.unit_price),
    reference: p.purchases?.reference_no ?? "",
  }));
  const saleRefs = (movements ?? []).filter((m: any) =>
    m.reference_id && ["sale", "sale_reversal"].includes(m.reference_type)).map((m: any) => m.reference_id);
  const { data: saleRefsData = [] } = useQuery({
    queryKey: ["ledger-sale-references", product?.id, saleRefs.join(",")],
    enabled: !!product && saleRefs.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("sales")
        .select("id,invoice_no").in("id", [...new Set(saleRefs)]);
      if (error) throw error;
      return data ?? [];
    },
  });
  const saleMap = new Map(saleRefsData.map((x: any) => [x.id, x.invoice_no]));
  const purchaseMap=new Map((purchaseLines??[]).map((x:any)=>[x.purchase_id,x]));
  return (
    <Dialog open={!!product} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Stock Ledger · {product?.name}</DialogTitle></DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild><Link to="/purchases/new" onClick={onClose}><ShoppingCart className="mr-2 h-4 w-4" />New Purchase</Link></Button>
          <Button size="sm" variant="outline" asChild><Link to="/sales/new" onClick={onClose}><Receipt className="mr-2 h-4 w-4" />New Sale</Link></Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Last Purchase Price</p><p className="text-lg font-semibold">{priceRows.length ? formatCurrency(priceRows[0].unit_price) : "—"}</p><p className="text-xs text-muted-foreground">{priceRows[0]?.purchases?.purchase_date ?? "No purchase history"}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Lowest Purchase Price</p><p className="text-lg font-semibold">{lowest === null ? "—" : formatCurrency(lowest)}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Highest Purchase Price</p><p className="text-lg font-semibold">{highest === null ? "—" : formatCurrency(highest)}</p></CardContent></Card>
        </div>
        <div className="rounded-lg border p-3">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><TrendingUp className="h-4 w-4" />Purchase Price History (PKR per {product?.unit ?? "unit"})</h3>
          {pricesLoading ? <Skeleton className="h-44 w-full" /> : pricesError ? <p className="text-sm text-destructive">Could not load purchase prices.</p> : chartData.length === 0 ? <p className="text-sm text-muted-foreground">No recorded purchases for this product.</p> :
            <ResponsiveContainer width="100%" height={180}><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={20} /><YAxis tick={{ fontSize: 11 }} width={65} domain={["auto", "auto"]} /><Tooltip formatter={(v: any) => formatCurrency(Number(v))} labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.reference ?? ""} /><Line type="monotone" dataKey="price" stroke="hsl(var(--primary))" strokeWidth={2} dot={chartData.length < 40} /></LineChart></ResponsiveContainer>}
          <p className="mt-2 text-xs text-muted-foreground">Prices reflect recorded purchase lines; high/low are based on the latest 500 entries, not stock valuation.</p>
        </div>
        <div className="rounded-lg border p-3">
          <h3 className="mb-2 text-sm font-semibold">Recent Purchases</h3>
          <div className="max-h-44 overflow-y-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Invoice</TableHead><TableHead>Supplier</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>
            {priceRows.slice(0, 10).map((p: any) => <TableRow key={p.id}><TableCell>{p.purchases?.purchase_date ?? "—"}</TableCell><TableCell><Button variant="link" size="sm" className="h-auto p-0" asChild><Link to="/purchases/edit/$id" params={{ id: p.purchase_id }} onClick={onClose}>{p.purchases?.reference_no ?? "View Purchase"}</Link></Button></TableCell><TableCell>{p.purchases?.suppliers?.name ?? "—"}</TableCell><TableCell className="text-right">{formatNumber(p.quantity)}</TableCell><TableCell className="text-right">{formatCurrency(p.unit_price)}</TableCell><TableCell className="text-right">{formatCurrency(p.line_total)}</TableCell></TableRow>)}
            {priceRows.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No purchases recorded.</TableCell></TableRow>}
          </TableBody></Table></div>
        </div>
        {isLoading ? <Skeleton className="h-40 w-full" /> : (movements ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No movements yet.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Reference / Supplier</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit Price</TableHead><TableHead className="text-right">Value</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
              <TableBody>
                {(movements ?? []).map((m: any) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs">{formatDate(m.created_at)}</TableCell>
                    <TableCell>
                      <Badge className={m.movement_type === "in" ? "bg-success/15 text-success border border-success/30" : "bg-destructive/15 text-destructive border border-destructive/30"}>
                        {m.reference_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {purchaseMap.has(m.reference_id) ? <Link className="font-medium text-primary underline-offset-2 hover:underline" to="/purchases/edit/$id" params={{ id: m.reference_id }} onClick={onClose}>{purchaseMap.get(m.reference_id)?.purchases?.reference_no ?? "View Purchase"}</Link>
                        : saleMap.has(m.reference_id) ? <Link className="font-medium text-primary underline-offset-2 hover:underline" to="/sales/edit/$id" params={{ id: m.reference_id }} onClick={onClose}>{saleMap.get(m.reference_id)}</Link>
                        : m.reference_type}
                      <div className="text-muted-foreground">{purchaseMap.get(m.reference_id)?.purchases?.suppliers?.name ?? ""}</div>
                    </TableCell>
                    <TableCell className={`text-right ${m.movement_type === "in" ? "text-success" : "text-destructive"}`}>
                      {m.movement_type === "in" ? "+" : "-"}{formatNumber(m.quantity)}
                    </TableCell>
                    <TableCell className="text-right">{purchaseMap.has(m.reference_id)?formatCurrency(purchaseMap.get(m.reference_id)?.unit_price):"—"}</TableCell>
                    <TableCell className="text-right">{purchaseMap.has(m.reference_id)?formatCurrency(Number(m.quantity)*Number(purchaseMap.get(m.reference_id)?.unit_price??0)):"—"}</TableCell>
                    <TableCell className="text-right font-medium">{formatNumber(m.balance_after)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}