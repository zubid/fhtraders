import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Eye, Printer, HandCoins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { PaymentStatusBadge } from "@/components/app/PaymentStatusBadge";
import { PaySupplierDialog } from "@/components/app/PaySupplierDialog";
import { purchaseBalance } from "@/lib/supplier-credit";
import { formatCurrency, formatDate } from "@/lib/format";
import { printPurchase } from "@/lib/print";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/purchases")({
  component: PurchasesPage,
});

function PurchasesPage() {
  const qc = useQueryClient();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [toDelete, setToDelete] = useState<any>(null);
  const [view, setView] = useState<any>(null);
  const [payFor, setPayFor] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["purchases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select("*, suppliers(name), purchase_items(id, quantity, unit_price, line_total, products(name, unit))")
        .order("purchase_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (from) rows = rows.filter((r) => r.purchase_date >= from);
    if (to) rows = rows.filter((r) => r.purchase_date <= to);
    return rows;
  }, [data, from, to]);

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("purchases").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries();
      setToDelete(null);
      toast.success("Purchase deleted and stock reversed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Purchases"
        description="Stock in — record supplier purchases"
        actions={<Button asChild><Link to="/purchases/new"><Plus className="mr-1 h-4 w-4" />New Purchase</Link></Button>}
      />
      <Card className="p-4">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div><label className="text-xs text-muted-foreground">From</label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">To</label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          {(from || to) && <Button variant="ghost" onClick={() => { setFrom(""); setTo(""); }}>Clear</Button>}
        </div>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No purchases found.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Items</TableHead><TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.reference_no}</TableCell>
                    <TableCell>{formatDate(p.purchase_date)}</TableCell>
                    <TableCell>{p.suppliers?.name ?? "-"}</TableCell>
                    <TableCell className="text-right">{p.purchase_items?.length ?? 0}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(p.grand_total)}</TableCell>
                    <TableCell className="text-right text-success">{formatCurrency((p as any).amount_paid ?? 0)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(purchaseBalance(p as any))}</TableCell>
                    <TableCell><PaymentStatusBadge status={(p as any).payment_status ?? "unpaid"} /></TableCell>
                    <TableCell className="text-right">
                      {p.supplier_id && purchaseBalance(p as any) > 0.001 && (
                        <Button variant="ghost" size="icon" title="Pay" onClick={() => setPayFor(p)}><HandCoins className="h-4 w-4" /></Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => setView(p)}><Eye className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => printPurchase(p)}><Printer className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setToDelete(p)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Dialog open={!!view} onOpenChange={(v) => !v && setView(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{view?.reference_no}</DialogTitle></DialogHeader>
          {view && (
            <div>
              <p className="mb-3 text-sm text-muted-foreground">{formatDate(view.purchase_date)} · {view.suppliers?.name ?? "No supplier"}</p>
              <Table>
                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                <TableBody>
                  {view.purchase_items?.map((it: any) => (
                    <TableRow key={it.id}>
                      <TableCell>{it.products?.name}</TableCell>
                      <TableCell className="text-right">{it.quantity} {it.products?.unit}</TableCell>
                      <TableCell className="text-right">{formatCurrency(it.unit_price)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(it.line_total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-4 flex justify-end text-lg font-bold">Total: {formatCurrency(view.grand_total)}</div>
              <Button className="mt-4 w-full" variant="outline" onClick={() => printPurchase(view)}><Printer className="mr-1 h-4 w-4" />Print / Download PDF</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Delete purchase?"
        description="This reverses the stock that was added by this purchase."
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
      />

      {payFor && (
        <PaySupplierDialog
          open={!!payFor}
          onOpenChange={(v) => !v && setPayFor(null)}
          supplierId={payFor.supplier_id}
          supplierName={payFor.suppliers?.name}
          presetPurchaseId={payFor.id}
        />
      )}
    </div>
  );
}