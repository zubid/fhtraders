import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Eye, Printer, HandCoins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { PaymentStatusBadge } from "@/components/app/PaymentStatusBadge";
import { ReceivePaymentDialog } from "@/components/app/ReceivePaymentDialog";
import { saleBalance } from "@/lib/credit";
import { formatCurrency, formatDate } from "@/lib/format";
import { printInvoice } from "@/lib/invoice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/sales")({
  component: SalesPage,
});

function SalesPage() {
  const qc = useQueryClient();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("all");
  const [toDelete, setToDelete] = useState<any>(null);
  const [view, setView] = useState<any>(null);
  const [pay, setPay] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["sales"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("*, restaurants(name), sale_items(id, quantity, unit_price, line_total, products(name, unit))")
        .order("sale_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (from) rows = rows.filter((r) => r.sale_date >= from);
    if (to) rows = rows.filter((r) => r.sale_date <= to);
    if (status !== "all") rows = rows.filter((r) => r.payment_status === status);
    return rows;
  }, [data, from, to, status]);

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sales").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries();
      setToDelete(null);
      toast.success("Sale deleted and stock restored");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Sales"
        description="Stock out — sales to restaurants (on credit)"
        actions={<Button asChild><Link to="/sales/new"><Plus className="mr-1 h-4 w-4" />New Sale</Link></Button>}
      />
      <Card className="p-4">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div><label className="text-xs text-muted-foreground">From</label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">To</label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div>
            <label className="text-xs text-muted-foreground">Status</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="unpaid">Unpaid</SelectItem>
                <SelectItem value="partial">Partially Paid</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(from || to || status !== "all") && <Button variant="ghost" onClick={() => { setFrom(""); setTo(""); setStatus("all"); }}>Clear</Button>}
        </div>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No sales found.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Restaurant</TableHead>
                  <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Balance</TableHead><TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => {
                  const bal = saleBalance(s);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.invoice_no}</TableCell>
                      <TableCell>{formatDate(s.sale_date)}</TableCell>
                      <TableCell>{s.restaurants?.name ?? "-"}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(s.grand_total)}</TableCell>
                      <TableCell className="text-right text-success">{formatCurrency(s.amount_received)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(bal)}</TableCell>
                      <TableCell><PaymentStatusBadge status={s.payment_status} /></TableCell>
                      <TableCell className="text-right">
                        {bal > 0 && s.restaurant_id && (
                          <Button variant="ghost" size="icon" title="Receive payment" onClick={() => setPay(s)}><HandCoins className="h-4 w-4 text-success" /></Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => setView(s)}><Eye className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => printInvoice(s)}><Printer className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setToDelete(s)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Dialog open={!!view} onOpenChange={(v) => !v && setView(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{view?.invoice_no}</DialogTitle></DialogHeader>
          {view && (
            <div>
              <p className="mb-3 text-sm text-muted-foreground">{formatDate(view.sale_date)} · {view.restaurants?.name ?? "Walk-in"}</p>
              <Table>
                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                <TableBody>
                  {view.sale_items?.map((it: any) => (
                    <TableRow key={it.id}>
                      <TableCell>{it.products?.name}</TableCell>
                      <TableCell className="text-right">{it.quantity} {it.products?.unit}</TableCell>
                      <TableCell className="text-right">{formatCurrency(it.unit_price)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(it.line_total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-4 space-y-1 text-sm">
                <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(view.subtotal)}</span></div>
                <div className="flex justify-between"><span>Discount</span><span>-{formatCurrency(view.discount)}</span></div>
                <div className="flex justify-between"><span>Tax</span><span>{formatCurrency(view.tax)}</span></div>
                <div className="flex justify-between border-t border-border pt-1 text-lg font-bold"><span>Total</span><span>{formatCurrency(view.grand_total)}</span></div>
                <div className="flex justify-between text-success"><span>Amount Received</span><span>{formatCurrency(view.amount_received)}</span></div>
                <div className="flex justify-between font-semibold"><span>Balance Due</span><span>{formatCurrency(saleBalance(view))}</span></div>
              </div>
              <Button className="mt-4 w-full" variant="outline" onClick={() => printInvoice(view)}><Printer className="mr-1 h-4 w-4" />Print / Download PDF</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {pay && (
        <ReceivePaymentDialog
          open={!!pay}
          onOpenChange={(v) => !v && setPay(null)}
          restaurantId={pay.restaurant_id}
          restaurantName={pay.restaurants?.name}
          presetSaleId={pay.id}
        />
      )}

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Delete sale?"
        description="This restores the stock that was deducted by this sale."
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
      />
    </div>
  );
}
