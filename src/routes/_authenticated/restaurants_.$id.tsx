import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Phone, Mail, MapPin, CreditCard, HandCoins, Printer, Download } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { PaymentStatusBadge } from "@/components/app/PaymentStatusBadge";
import { ReceivePaymentDialog } from "@/components/app/ReceivePaymentDialog";
import { saleBalance, METHOD_LABELS } from "@/lib/credit";
import { printInvoice, printStatement } from "@/lib/invoice";
import { formatCurrency, formatDate, formatNumber, downloadCSV } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/restaurants_/$id")({
  component: RestaurantProfile,
});

const CHART_COLORS = ["#0f766e", "#0891b2", "#7c3aed", "#db2777", "#ea580c", "#65a30d", "#ca8a04"];
const PAGE_SIZE = 10;

function RestaurantProfile() {
  const { id } = Route.useParams();
  const [payOpen, setPayOpen] = useState(false);
  const [salesStatus, setSalesStatus] = useState("all");
  const [sFrom, setSFrom] = useState("");
  const [sTo, setSTo] = useState("");
  const [page, setPage] = useState(0);
  const [cFrom, setCFrom] = useState("");
  const [cTo, setCTo] = useState("");

  const { data: restaurant, isLoading } = useQuery({
    queryKey: ["restaurant", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("restaurants").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: sales } = useQuery({
    queryKey: ["restaurant-sales", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("*, sale_items(quantity, line_total, unit_price, products(name, unit, categories(name)))")
        .eq("restaurant_id", id)
        .order("sale_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: payments } = useQuery({
    queryKey: ["restaurant-payments", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*, sales(invoice_no)")
        .eq("restaurant_id", id)
        .order("payment_date", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const lifetime = (sales ?? []).reduce((s, x) => s + Number(x.grand_total), 0);
  const received = (sales ?? []).reduce((s, x) => s + Number(x.amount_received), 0);
  const outstanding = Math.max(0, lifetime - received);
  const orders = sales?.length ?? 0;

  // Sales history filtered + paginated
  const filteredSales = useMemo(() => {
    let rows = sales ?? [];
    if (salesStatus !== "all") rows = rows.filter((s) => s.payment_status === salesStatus);
    if (sFrom) rows = rows.filter((s) => s.sale_date >= sFrom);
    if (sTo) rows = rows.filter((s) => s.sale_date <= sTo);
    return rows;
  }, [sales, salesStatus, sFrom, sTo]);
  const pageCount = Math.max(1, Math.ceil(filteredSales.length / PAGE_SIZE));
  const pageSales = filteredSales.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  // Category breakdown (date filtered)
  const catRows = useMemo(() => {
    const map = new Map<string, { qty: number; value: number }>();
    (sales ?? [])
      .filter((s) => (!cFrom || s.sale_date >= cFrom) && (!cTo || s.sale_date <= cTo))
      .forEach((sale) =>
        (sale.sale_items ?? []).forEach((it: any) => {
          const cat = it.products?.categories?.name ?? "Uncategorized";
          const cur = map.get(cat) ?? { qty: 0, value: 0 };
          cur.qty += Number(it.quantity);
          cur.value += Number(it.line_total);
          map.set(cat, cur);
        }),
      );
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.value - a.value);
  }, [sales, cFrom, cTo]);

  // Payment ledger with running balance
  const ledger = useMemo(() => {
    const salesAsc = [...(sales ?? [])].sort((a, b) => a.sale_date.localeCompare(b.sale_date));
    let cumPaid = 0;
    const rows = (payments ?? []).map((p: any) => {
      cumPaid += Number(p.amount);
      const salesToDate = salesAsc
        .filter((s) => s.sale_date <= p.payment_date)
        .reduce((sum, s) => sum + Number(s.grand_total), 0);
      return { ...p, running: Math.max(0, salesToDate - cumPaid) };
    });
    return rows.reverse();
  }, [sales, payments]);

  const exportStatement = () => {
    const rows: (string | number)[][] = [
      ["Statement of Account", restaurant?.name ?? ""],
      [],
      ["Type", "Reference", "Date", "Debit (Sale)", "Credit (Payment)"],
    ];
    const events = [
      ...(sales ?? []).map((s) => ({ date: s.sale_date, type: "Sale", ref: s.invoice_no, debit: Number(s.grand_total), credit: 0 })),
      ...(payments ?? []).map((p: any) => ({ date: p.payment_date, type: "Payment", ref: p.sales?.invoice_no ?? "General", debit: 0, credit: Number(p.amount) })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    let bal = 0;
    events.forEach((e) => { bal += e.debit - e.credit; rows.push([e.type, e.ref, e.date, e.debit || "", e.credit || ""]); });
    rows.push([]);
    rows.push(["", "", "Outstanding Balance", "", bal.toFixed(2)]);
    downloadCSV(`statement-${restaurant?.name ?? "account"}.csv`, rows);
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!restaurant) return <div className="py-12 text-center text-muted-foreground">Restaurant not found.</div>;

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/restaurants"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link></Button>
      <PageHeader
        title={restaurant.name}
        description={restaurant.is_active ? "Active account" : "Inactive account"}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => printStatement({ restaurant, sales: sales ?? [], payments: payments ?? [] })}><Printer className="mr-1 h-4 w-4" />Statement (PDF)</Button>
            <Button variant="outline" onClick={exportStatement}><Download className="mr-1 h-4 w-4" />Statement (CSV)</Button>
            <Button onClick={() => setPayOpen(true)}><HandCoins className="mr-1 h-4 w-4" />Receive Payment</Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Outstanding Balance</p><p className={`mt-1 text-2xl font-bold ${outstanding > 0 ? "text-destructive" : "text-success"}`}>{formatCurrency(outstanding)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Lifetime Sales</p><p className="mt-1 text-2xl font-bold">{formatCurrency(lifetime)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Received</p><p className="mt-1 text-2xl font-bold text-success">{formatCurrency(received)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Orders</p><p className="mt-1 text-2xl font-bold">{orders}</p></CardContent></Card>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="sales">Sales History</TabsTrigger>
          <TabsTrigger value="category">Category-wise</TabsTrigger>
          <TabsTrigger value="payments">Payment History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader><CardTitle className="text-base">Contact Details</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {restaurant.contact_person && <div className="flex items-center gap-2"><Badge variant="secondary">Contact</Badge>{restaurant.contact_person}</div>}
              {restaurant.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-4 w-4" />{restaurant.phone}</div>}
              {restaurant.email && <div className="flex items-center gap-2 text-muted-foreground"><Mail className="h-4 w-4" />{restaurant.email}</div>}
              {restaurant.address && <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="h-4 w-4" />{restaurant.address}</div>}
              {restaurant.credit_terms && <div className="flex items-center gap-2 text-muted-foreground"><CreditCard className="h-4 w-4" />{restaurant.credit_terms}</div>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sales">
          <Card>
            <CardContent className="pt-6">
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <div><label className="text-xs text-muted-foreground">From</label><Input type="date" value={sFrom} onChange={(e) => { setSFrom(e.target.value); setPage(0); }} /></div>
                <div><label className="text-xs text-muted-foreground">To</label><Input type="date" value={sTo} onChange={(e) => { setSTo(e.target.value); setPage(0); }} /></div>
                <div>
                  <label className="text-xs text-muted-foreground">Status</label>
                  <Select value={salesStatus} onValueChange={(v) => { setSalesStatus(v); setPage(0); }}>
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
              {filteredSales.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No sales found.</p> : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Items</TableHead>
                        <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Received</TableHead>
                        <TableHead className="text-right">Balance</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {pageSales.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="font-mono text-xs">{s.invoice_no}</TableCell>
                            <TableCell>{formatDate(s.sale_date)}</TableCell>
                            <TableCell className="text-right">{s.sale_items?.length ?? 0}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(s.grand_total)}</TableCell>
                            <TableCell className="text-right text-success">{formatCurrency(s.amount_received)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(saleBalance(s))}</TableCell>
                            <TableCell><PaymentStatusBadge status={s.payment_status} /></TableCell>
                            <TableCell className="text-right"><Button variant="ghost" size="icon" onClick={() => printInvoice({ ...s, restaurants: { name: restaurant.name } })}><Printer className="h-4 w-4" /></Button></TableCell>
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

        <TabsContent value="category">
          <Card>
            <CardContent className="pt-6">
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <div><label className="text-xs text-muted-foreground">From</label><Input type="date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} /></div>
                <div><label className="text-xs text-muted-foreground">To</label><Input type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} /></div>
              </div>
              {catRows.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No category data.</p> : (
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={catRows} layout="vertical" margin={{ left: 20 }}>
                        <XAxis type="number" tickFormatter={(v) => formatNumber(v, 0)} fontSize={12} />
                        <YAxis type="category" dataKey="name" width={100} fontSize={12} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                          {catRows.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <Table>
                    <TableHeader><TableRow><TableHead>Category</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {catRows.map((c) => (
                        <TableRow key={c.name}>
                          <TableCell className="font-medium">{c.name}</TableCell>
                          <TableCell className="text-right">{formatNumber(c.qty)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(c.value)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
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
                      <TableHead>Date</TableHead><TableHead>Invoice</TableHead><TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Balance After</TableHead><TableHead>Note</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {ledger.map((p: any) => (
                        <TableRow key={p.id}>
                          <TableCell>{formatDate(p.payment_date)}</TableCell>
                          <TableCell className="font-mono text-xs">{p.sales?.invoice_no ?? "General"}</TableCell>
                          <TableCell>{METHOD_LABELS[p.method] ?? p.method}</TableCell>
                          <TableCell className="text-right font-medium text-success">{formatCurrency(p.amount)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(p.running)}</TableCell>
                          <TableCell className="text-muted-foreground">{p.note ?? "-"}</TableCell>
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

      <ReceivePaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        restaurantId={id}
        restaurantName={restaurant.name}
      />
    </div>
  );
}
