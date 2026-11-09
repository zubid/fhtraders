import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  HandCoins,
  Download,
  User,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { PaymentStatusBadge } from "@/components/app/PaymentStatusBadge";
import { PaySupplierDialog } from "@/components/app/PaySupplierDialog";
import { purchaseBalance, METHOD_LABELS } from "@/lib/supplier-credit";
import { buildSupplierLedger, supplierStatementPeriod } from "@/lib/supplier-ledger";
import { formatCurrency, formatDate, downloadCSV } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/suppliers_/$id")({
  component: SupplierProfile,
});

const PAGE_SIZE = 10;

function SupplierProfile() {
  const { id } = Route.useParams();
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

  const { data: purchases, isLoading: purchasesLoading, error: purchasesError } = useQuery({
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

  const { data: payments, isLoading: paymentsLoading, error: paymentsError } = useQuery({
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


  const statement = useMemo(() => buildSupplierLedger(purchases ?? [], payments ?? []), [purchases, payments]);
  const period = useMemo(() => supplierStatementPeriod(statement.rows, from, to), [statement, from, to]);
  const lifetime = statement.totalPurchases;
  const paid = statement.totalPayments;
  const outstanding = statement.expectedBalance;
  const orders = purchases?.length ?? 0;
  const statementReady = !purchasesLoading && !paymentsLoading && !purchasesError && !paymentsError;

  const filtered = useMemo(() => {
    let rows = purchases ?? [];
    if (status !== "all") rows = rows.filter((p: any) => p.payment_status === status);
    if (from) rows = rows.filter((p: any) => p.purchase_date >= from);
    if (to) rows = rows.filter((p: any) => p.purchase_date <= to);
    return rows;
  }, [purchases, status, from, to]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagePurchases = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const exportStatement = () => {
    if (!statementReady || statement.discrepancy !== 0) return;
    const rows: (string | number)[][] = [
      ["FH Traders — Supplier Statement"],
      ["Supplier", supplier?.name ?? ""],
      ["From", from || "Beginning"], ["To", to || "Latest"],
      ["Opening Payable", period.opening.toFixed(2)],
      [],
      ["Date", "Type", "Reference", "Purchase (Debit)", "Payment (Credit)", "Running Payable", "Note"],
      ...period.rows.map(e => [e.date, e.type, e.reference, e.debit || "", e.credit || "", e.balance.toFixed(2), e.note]),
      [],
      ["Total Purchases", period.purchases.toFixed(2)],
      ["Total Payments", period.payments.toFixed(2)],
      ["Closing Payable", period.closing.toFixed(2)],
      ["Historical payments included", statement.historicalPayments.toFixed(2)],
    ];
    downloadCSV(`supplier-statement-${id}-${from || "all"}-${to || "latest"}.csv`, rows);
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
            <Button variant="outline" onClick={exportStatement} disabled={!statementReady || Math.abs(statement.discrepancy) > 0.009}><Download className="mr-1 h-4 w-4" />Statement (CSV)</Button>
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
          <TabsTrigger value="ledger">Ledger & Statement</TabsTrigger>
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
              {(payments ?? []).length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No payments recorded.</p> : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Date</TableHead><TableHead>Purchase</TableHead><TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Balance After</TableHead><TableHead>Note</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {(payments ?? []).map((p: any) => (
                        <TableRow key={p.id}>
                          <TableCell>{formatDate(p.payment_date)}</TableCell>
                          <TableCell className="font-mono text-xs">{p.purchases?.reference_no ?? "General"}</TableCell>
                          <TableCell>{METHOD_LABELS[p.method] ?? p.method}</TableCell>
                          <TableCell className="text-right font-medium text-success">{formatCurrency(p.amount)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(statement.rows.find(e => e.id === "payment-" + p.id)?.balance ?? 0)}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {p.note ?? "-"}
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
        <TabsContent value="ledger">
          <Card>
            <CardHeader><CardTitle className="text-base">Supplier Ledger & Statement</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div><label className="text-xs text-muted-foreground">From</label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
                <div><label className="text-xs text-muted-foreground">To</label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
                <Button variant="outline" onClick={() => { setFrom(""); setTo(""); }}>All dates</Button>
                <Button disabled={!statementReady || !!(from && to && from > to) || Math.abs(statement.discrepancy) > 0.009} onClick={exportStatement}><Download className="mr-1 h-4 w-4" />Download Statement (CSV)</Button>
              </div>
              {!statementReady ? <p className="text-sm text-destructive">{purchasesError || paymentsError ? "Unable to load complete ledger. Statement disabled." : "Loading complete ledger..."}</p> : null}
              {Math.abs(statement.discrepancy) > 0.009 && <p className="rounded border border-destructive p-3 text-sm text-destructive">Reconciliation difference {formatCurrency(statement.discrepancy)}. Please review purchase/payment history before exporting. No balances have been modified.</p>}
              {statement.historicalPayments > 0 && <p className="rounded border p-3 text-sm text-muted-foreground">Historical payments of {formatCurrency(statement.historicalPayments)} have no individually dated payment records. They are displayed separately at purchase date for reconciliation.</p>}
              <div className="grid gap-3 sm:grid-cols-4">
                <div><p className="text-xs text-muted-foreground">Opening</p><p className="font-semibold">{formatCurrency(period.opening)}</p></div>
                <div><p className="text-xs text-muted-foreground">Purchases</p><p className="font-semibold">{formatCurrency(period.purchases)}</p></div>
                <div><p className="text-xs text-muted-foreground">Payments</p><p className="font-semibold">{formatCurrency(period.payments)}</p></div>
                <div><p className="text-xs text-muted-foreground">Closing Payable</p><p className="font-semibold">{formatCurrency(period.closing)}</p></div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Purchase</TableHead><TableHead className="text-right">Payment</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
                  <TableBody>{period.rows.map(e => <TableRow key={e.id}>
                    <TableCell>{formatDate(e.date)}</TableCell><TableCell>{e.type}</TableCell><TableCell className="font-mono text-xs">{e.reference}</TableCell>
                    <TableCell className="text-right">{e.debit ? formatCurrency(e.debit) : "—"}</TableCell>
                    <TableCell className="text-right">{e.credit ? formatCurrency(e.credit) : "—"}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(e.balance)}</TableCell><TableCell className="text-xs text-muted-foreground">{e.note || "—"}</TableCell>
                  </TableRow>)}</TableBody>
                </Table>
              </div>
              {statementReady && period.rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No transactions for this period.</p>}
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
