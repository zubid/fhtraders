import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, History, Download, Coins } from "lucide-react";
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

  return (
    <Dialog open={!!product} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Stock Ledger · {product?.name}</DialogTitle></DialogHeader>
        {isLoading ? <Skeleton className="h-40 w-full" /> : (movements ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No movements yet.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
              <TableBody>
                {(movements ?? []).map((m: any) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-xs">{formatDate(m.created_at)}</TableCell>
                    <TableCell>
                      <Badge className={m.movement_type === "in" ? "bg-success/15 text-success border border-success/30" : "bg-destructive/15 text-destructive border border-destructive/30"}>
                        {m.reference_type}
                      </Badge>
                    </TableCell>
                    <TableCell className={`text-right ${m.movement_type === "in" ? "text-success" : "text-destructive"}`}>
                      {m.movement_type === "in" ? "+" : "-"}{formatNumber(m.quantity)}
                    </TableCell>
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