import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  HandCoins,
  Download,
  User,
  Pencil,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { PaymentStatusBadge } from "@/components/app/PaymentStatusBadge";
import { PaySupplierDialog } from "@/components/app/PaySupplierDialog";
import { purchaseBalance, METHOD_LABELS } from "@/lib/supplier-credit";
import { formatCurrency, formatDate, downloadCSV } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/suppliers_/$id")({
  component: SupplierProfile,
});

const PAGE_SIZE = 10;

function SupplierProfile() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  
  const [editingPayment, setEditingPayment] = useState<any>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);

  const { data: supplier, isLoading } = useQuery({
    queryKey: ["supplier", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: purchases } = useQuery({
    queryKey: ["supplier-purchases", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select("*, purchase_items(id, quantity, unit_price, line_total, products(name, unit))")
        .eq("supplier_id", id)
        .order("purchase_date", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: payments } = useQuery({
  queryKey: ["supplier-payments-list", id],
  queryFn: async () => {
    const { data, error } = await (supabase.from("supplier_payments" as any) as any)
      .select("*, purchases(reference_no)")
      .eq("supplier_id", id)
      .order("payment_date", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as any[];
  },
});


// ADD THIS HERE
const deletePayment = useMutation({
  mutationFn: async (paymentId: string) => {
    const { error } = await (supabase
      .from("supplier_payments" as any) as any)
      .delete()
      .eq("id", paymentId);

    if (error) throw error;
  },

  onSuccess: () => {
    toast.success("Payment removed and vault balance returned");
    qc.invalidateQueries();
  },

  onError: (e: Error) => {
    toast.error(e.message);
  },
});

  const lifetime = (purchases ?? []).reduce((s, x: any) => s + Number(x.grand_total), 0);
  const paid = (purchases ?? []).reduce((s, x: any) => s + Number(x.amount_paid), 0);
  const outstanding = Math.max(0, lifetime - paid);
  const orders = purchases?.length ?? 0;

  const filtered = useMemo(() => {
    let rows = purchases ?? [];
    if (status !== "all") rows = rows.filter((p: any) => p.payment_status === status);
    if (from) rows = rows.filter((p: any) => p.purchase_date >= from);
    if (to) rows = rows.filter((p: any) => p.purchase_date <= to);
    return rows;
  }, [purchases, status, from, to]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagePurchases = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const ledger = useMemo(() => {
    const pAsc = [...(purchases ?? [])].sort((a: any, b: any) => a.purchase_date.localeCompare(b.purchase_date));
    let cumPaid = 0;
    const rows = (payments ?? []).map((p: any) => {
      cumPaid += Number(p.amount);
      const purToDate = pAsc
        .filter((s: any) => s.purchase_date <= p.payment_date)
        .reduce((sum, s: any) => sum + Number(s.grand_total), 0);
      return { ...p, running: Math.max(0, purToDate - cumPaid) };
    });
    return rows.reverse();
  }, [purchases, payments]);

  const exportStatement = () => {
    const rows: (string | number)[][] = [
      ["Supplier Statement", supplier?.name ?? ""],
      [],
      ["Type", "Reference", "Date", "Credit (Purchase)", "Debit (Payment)"],
    ];
    const events = [
      ...(purchases ?? []).map((s: any) => ({ date: s.purchase_date, type: "Purchase", ref: s.reference_no, credit: Number(s.grand_total), debit: 0 })),
      ...(payments ?? []).map((p: any) => ({ date: p.payment_date, type: "Payment", ref: p.purchases?.reference_no ?? "General", credit: 0, debit: Number(p.amount) })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    let bal = 0;
    events.forEach((e) => { bal += e.credit - e.debit; rows.push([e.type, e.ref, e.date, e.credit || "", e.debit || ""]); });
    rows.push([]);
    rows.push(["", "", "Payable Balance", "", bal.toFixed(2)]);
    downloadCSV(`supplier-${supplier?.name ?? "account"}.csv`, rows);
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!supplier) return <div className="py-12 text-center text-muted-foreground">Supplier not found.</div>;

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/suppliers"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link></Button>
      <PageHeader
        title={supplier.name}
        description="Supplier account"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportStatement}><Download className="mr-1 h-4 w-4" />Statement (CSV)</Button>
            <Button onClick={() => setPayOpen(true)}><HandCoins className="mr-1 h-4 w-4" />Pay Supplier</Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Payable Balance</p><p className={`mt-1 text-2xl font-bold ${outstanding > 0 ? "text-destructive" : "text-success"}`}>{formatCurrency(outstanding)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Lifetime Purchases</p><p className="mt-1 text-2xl font-bold">{formatCurrency(lifetime)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Paid</p><p className="mt-1 text-2xl font-bold text-success">{formatCurrency(paid)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Purchases</p><p className="mt-1 text-2xl font-bold">{orders}</p></CardContent></Card>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="purchases">Purchases</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader><CardTitle className="text-base">Contact Details</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {supplier.contact_person && <div className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" /><Badge variant="secondary">Contact</Badge>{supplier.contact_person}</div>}
              {supplier.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-4 w-4" />{supplier.phone}</div>}
              {supplier.email && <div className="flex items-center gap-2 text-muted-foreground"><Mail className="h-4 w-4" />{supplier.email}</div>}
              {supplier.address && <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="h-4 w-4" />{supplier.address}</div>}
              {!supplier.contact_person && !supplier.phone && !supplier.email && !supplier.address && (
                <p className="text-muted-foreground">No contact details on file.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="purchases">
          <Card>
            <CardContent className="pt-6">
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <div><label className="text-xs text-muted-foreground">From</label><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} /></div>
                <div><label className="text-xs text-muted-foreground">To</label><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} /></div>
                <div>
                  <label className="text-xs text-muted-foreground">Status</label>
                  <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="unpaid">Unpaid</SelectItem>
                      <SelectItem value="partial">Partially Paid</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {filtered.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No purchases found.</p> : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Reference</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Items</TableHead>
                        <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead>
                        <TableHead className="text-right">Balance</TableHead><TableHead>Status</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {pagePurchases.map((p: any) => (
                          <TableRow key={p.id}>
                            <TableCell className="font-mono text-xs">{p.reference_no}</TableCell>
                            <TableCell>{formatDate(p.purchase_date)}</TableCell>
                            <TableCell className="text-right">{p.purchase_items?.length ?? 0}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(p.grand_total)}</TableCell>
                            <TableCell className="text-right text-success">{formatCurrency(p.amount_paid)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(purchaseBalance(p))}</TableCell>
                            <TableCell><PaymentStatusBadge status={p.payment_status} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Page {page + 1} of {pageCount}</span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                      <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardContent className="pt-6">
              {ledger.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No payments recorded.</p> : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Date</TableHead><TableHead>Purchase</TableHead><TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Balance After</TableHead><TableHead>Note</TableHead>
<TableHead className="text-right">Actions</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {ledger.map((p: any) => (
                        <TableRow key={p.id}>
                          <TableCell>{formatDate(p.payment_date)}</TableCell>
                          <TableCell className="font-mono text-xs">{p.purchases?.reference_no ?? "General"}</TableCell>
                          <TableCell>{METHOD_LABELS[p.method] ?? p.method}</TableCell>
                          <TableCell className="text-right font-medium text-success">{formatCurrency(p.amount)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(p.running)}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {p.note ?? "-"}
                          </TableCell>
                          
                          <TableCell className="text-right space-x-2">
                            {/* <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setEditingPayment(p)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button> */}
                          
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deletePayment.mutate(p.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <PaySupplierDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        supplierId={id}
        supplierName={supplier.name}
      />
    </div>
  );
}
