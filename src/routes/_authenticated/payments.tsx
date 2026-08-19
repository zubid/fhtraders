import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { HandCoins, Trash2, Pencil, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { ReceivePaymentDialog } from "@/components/app/ReceivePaymentDialog";
import { EditPaymentDialog } from "@/components/app/EditPaymentDialog";
import { useAuth } from "@/hooks/useAuth";
import { saleBalance, deletePayment, METHOD_LABELS } from "@/lib/credit";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/payments")({
  component: PaymentsPage,
});

function PaymentsPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [restaurantFilter, setRestaurantFilter] = useState("all");
  const [payFor, setPayFor] = useState<{ id: string; name: string } | null>(null);
  const [toDelete, setToDelete] = useState<any>(null);
  const [toEdit, setToEdit] = useState<any>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: restaurants } = useQuery({
    queryKey: ["restaurants-min"],
    queryFn: async () => (await supabase.from("restaurants").select("id,name").order("name")).data ?? [],
  });

  const { data: sales } = useQuery({
    queryKey: ["sales-balances"],
    queryFn: async () =>
      (await supabase.from("sales").select("id,restaurant_id,grand_total,amount_received")).data ?? [],
  });

  const { data: payments, isLoading } = useQuery({
    queryKey: ["payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*, restaurants(name), sales(invoice_no)")
        .order("payment_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const balances = useMemo(() => {
    const map = new Map<string, number>();
    (sales ?? []).forEach((s: any) => {
      if (!s.restaurant_id) return;
      map.set(s.restaurant_id, (map.get(s.restaurant_id) ?? 0) + saleBalance(s));
    });
    return map;
  }, [sales]);

  const outstandingRestaurants = useMemo(
    () =>
      (restaurants ?? [])
        .map((r: any) => ({ ...r, balance: balances.get(r.id) ?? 0 }))
        .filter((r: any) => r.balance > 0.001)
        .sort((a: any, b: any) => b.balance - a.balance),
    [restaurants, balances],
  );

  const totalOutstanding = outstandingRestaurants.reduce((s: number, r: any) => s + r.balance, 0);

  const filteredPayments = useMemo(() => {
    let rows = payments ?? [];
    if (restaurantFilter !== "all") rows = rows.filter((p: any) => p.restaurant_id === restaurantFilter);
    if (from) rows = rows.filter((p: any) => p.payment_date >= from);
    if (to) rows = rows.filter((p: any) => p.payment_date <= to);
    return rows;
  }, [payments, restaurantFilter, from, to]);

  const del = useMutation({
    mutationFn: async (p: { id: string; restaurant_id: string }) => {
      await deletePayment(p.id, p.restaurant_id);
    },
    onSuccess: () => { qc.invalidateQueries(); setToDelete(null); toast.success("Payment deleted and balances updated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader title="Payments" description="Receive and track restaurant payments" />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Outstanding Balances</CardTitle>
            <Badge variant="secondary">{formatCurrency(totalOutstanding)}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {outstandingRestaurants.length === 0 ? (
              <p className="text-sm text-muted-foreground">No outstanding balances. 🎉</p>
            ) : (
              outstandingRestaurants.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg border border-border p-2">
                  <div className="flex items-center gap-2">
                    <Link to="/restaurants/$id" params={{ id: r.id }} className="text-sm font-medium hover:text-primary hover:underline">{r.name}</Link>
                    <Badge className="bg-destructive/15 text-destructive border border-destructive/30">{formatCurrency(r.balance)}</Badge>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setPayFor({ id: r.id, name: r.name })}>
                    <HandCoins className="mr-1 h-3.5 w-3.5" />Receive
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Payment History</CardTitle></CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="min-w-48">
                <label className="text-xs text-muted-foreground">Restaurant</label>
                <Select value={restaurantFilter} onValueChange={setRestaurantFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All restaurants</SelectItem>
                    {(restaurants ?? []).map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><label className="text-xs text-muted-foreground">From</label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><label className="text-xs text-muted-foreground">To</label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : filteredPayments.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No payments recorded.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Date</TableHead><TableHead>Restaurant</TableHead><TableHead>Invoice</TableHead>
                    <TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {filteredPayments.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell>{formatDate(p.payment_date)}</TableCell>
                        <TableCell>
                          <Link to="/restaurants/$id" params={{ id: p.restaurant_id }} className="inline-flex items-center gap-1 hover:text-primary hover:underline">
                            {p.restaurants?.name ?? "-"}<ExternalLink className="h-3 w-3" />
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{p.sales?.invoice_no ?? "General (FIFO)"}</TableCell>
                        <TableCell>{METHOD_LABELS[p.method] ?? p.method}</TableCell>
                        <TableCell className="text-right font-medium text-success">{formatCurrency(p.amount)}</TableCell>
                        <TableCell className="text-right">
                          {isAdmin && (
                            <>
                              <Button variant="ghost" size="icon" onClick={() => setToEdit(p)}><Pencil className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" onClick={() => setToDelete(p)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {payFor && (
        <ReceivePaymentDialog
          open={!!payFor}
          onOpenChange={(v) => !v && setPayFor(null)}
          restaurantId={payFor.id}
          restaurantName={payFor.name}
        />
      )}

      <EditPaymentDialog
        open={!!toEdit}
        onOpenChange={(v) => !v && setToEdit(null)}
        payment={toEdit}
      />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Delete payment?"
        description="This removes the payment from the ledger and automatically recalculates the affected invoice balances."
        onConfirm={() => toDelete && del.mutate({ id: toDelete.id, restaurant_id: toDelete.restaurant_id })}
      />
    </div>
  );
}
