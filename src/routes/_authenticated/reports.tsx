import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { PageHeader } from "@/components/app/PageHeader";
import { RangePicker } from "@/components/app/RangePicker";
import { useAuth } from "@/hooks/useAuth";
import { useAnalytics, useDateRange } from "@/lib/useAnalytics";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/reports")({ component: ReportsPage });
const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];
const status = (outstanding: number) => outstanding <= 0.001 ? "Paid" : "Outstanding";

function ReportsPage() {
  const { isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const { preset, setPreset, custom, setCustom, range } = useDateRange("month");
  const a = useAnalytics(range.from, range.to);
  useEffect(() => { if (!loading && !isAdmin) navigate({ to: "/dashboard", replace: true }); }, [loading, isAdmin, navigate]);
  if (!isAdmin) return null;
  const kpis = [
    ["Invoiced Sales", a.totalSales], ["Customer Cash Received", a.customerCashReceived],
    ["Outstanding Receivables", a.outstanding], ["Current Cash on Hand", a.currentCashOnHand],
    ["Supplier Payables", a.supplierPayables], ["Operating Expenses", a.totalExpenses],
    ["Gross Profit", a.grossProfit], ["Net Profit", a.netProfit],
  ] as const;
  return <div>
    <PageHeader title="Financial Reports" description="Transaction-led management reporting and secondary analytics" />
    <div className="mb-6"><RangePicker preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} /></div>
    {a.isLoading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{kpis.map(([name]) => <Skeleton key={name} className="h-24" />)}</div> :
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{kpis.map(([name, value]) => <Card key={name}><CardContent className="pt-6"><p className="text-sm text-muted-foreground">{name}</p><p className="mt-1 text-2xl font-bold">{formatCurrency(value)}</p></CardContent></Card>)}</div>}

    <Card className="mt-6"><CardHeader><CardTitle className="text-base">Transaction Histories · {formatDate(range.from)} – {formatDate(range.to)}</CardTitle></CardHeader><CardContent>
      <Tabs defaultValue="receipts"><TabsList className="mb-4 flex h-auto flex-wrap"><TabsTrigger value="receipts">Cash Receipts</TabsTrigger><TabsTrigger value="sales">Sales</TabsTrigger><TabsTrigger value="purchases">Purchases</TabsTrigger><TabsTrigger value="expenses">Expenses</TabsTrigger></TabsList>
        <TabsContent value="receipts"><ReportTable heads={["Date","Restaurant","Invoice / General","Payment Method","Received By Vault","Note","Amount"]}>
          {a.payments.map((p: any) => <TableRow key={p.id}><TableCell>{formatDate(p.payment_date)}</TableCell><TableCell>{p.restaurants?.name ?? "Unknown"}</TableCell><TableCell>{p.sales?.invoice_no ?? "General (FIFO)"}</TableCell><TableCell className="capitalize">{p.method}</TableCell><TableCell className={p.vault_users?.name ? "" : "font-semibold text-destructive"}>{p.vault_users?.name ?? "Missing Vault"}</TableCell><TableCell>{p.note ?? "-"}</TableCell><TableCell className="text-right font-medium">{formatCurrency(p.amount)}</TableCell></TableRow>)}
          <TotalRow span={6} label={`${a.payments.length} payments · Total received`} value={a.customerCashReceived} />
        </ReportTable></TabsContent>
        <TabsContent value="sales"><ReportTable heads={["Date","Invoice","Restaurant","Total Sale","Received","Outstanding","Status"]}>
          {a.sales.map((s: any) => { const due=Math.max(Number(s.grand_total)-Number(s.amount_received),0); return <TableRow key={s.id}><TableCell>{formatDate(s.sale_date)}</TableCell><TableCell>{s.invoice_no}</TableCell><TableCell>{s.restaurants?.name ?? "Unknown"}</TableCell><TableCell className="text-right">{formatCurrency(s.grand_total)}</TableCell><TableCell className="text-right">{formatCurrency(s.amount_received)}</TableCell><TableCell className="text-right">{formatCurrency(due)}</TableCell><TableCell><Badge variant={due ? "destructive" : "secondary"}>{status(due)}</Badge></TableCell></TableRow>; })}
          <TotalRow span={6} label={`${a.sales.length} sales · Invoiced total`} value={a.totalSales} />
        </ReportTable></TabsContent>
        <TabsContent value="purchases"><ReportTable heads={["Date","Reference","Supplier","Total Purchase","Paid","Outstanding","Status"]}>
          {a.purchases.map((p: any) => { const due=Math.max(Number(p.grand_total)-Number(p.amount_paid),0); return <TableRow key={p.id}><TableCell>{formatDate(p.purchase_date)}</TableCell><TableCell>{p.reference_no}</TableCell><TableCell>{p.suppliers?.name ?? "Unknown"}</TableCell><TableCell className="text-right">{formatCurrency(p.grand_total)}</TableCell><TableCell className="text-right">{formatCurrency(p.amount_paid)}</TableCell><TableCell className="text-right">{formatCurrency(due)}</TableCell><TableCell><Badge variant={due ? "destructive" : "secondary"}>{status(due)}</Badge></TableCell></TableRow>; })}
        </ReportTable></TabsContent>
        <TabsContent value="expenses"><ReportTable heads={["Date","Type","Category / Employee","Description","Paid From Vault","Amount"]}>
          {a.expenses.map((e: any) => <TableRow key={e.id}><TableCell>{formatDate(e.expense_date)}</TableCell><TableCell className="capitalize">{e.type}</TableCell><TableCell>{e.expense_categories?.name ?? e.employees?.name ?? "-"}</TableCell><TableCell>{e.description ?? "-"}</TableCell><TableCell>{e.vault_users?.name ?? "Missing Vault"}</TableCell><TableCell className="text-right">{formatCurrency(e.amount)}</TableCell></TableRow>)}
          <TotalRow span={5} label={`${a.expenses.length} expenses · Operating expenses`} value={a.totalExpenses} />
        </ReportTable></TabsContent>
      </Tabs>
    </CardContent></Card>

    <h2 className="mt-8 text-lg font-semibold">Secondary Analytics</h2>
    <div className="mt-3 grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Revenue by Category</CardTitle></CardHeader><CardContent className="h-72"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={a.byCategory} dataKey="revenue" nameKey="name" outerRadius={90}>{a.byCategory.map((_: any,i:number)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie><Tooltip formatter={(v:number)=>formatCurrency(v)}/></PieChart></ResponsiveContainer></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Profit by Category</CardTitle></CardHeader><CardContent className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={a.byCategory}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="name"/><YAxis/><Tooltip formatter={(v:number)=>formatCurrency(v)}/><Bar dataKey="profit" fill="var(--chart-3)"/></BarChart></ResponsiveContainer></CardContent></Card></div>
    <Card className="mt-4"><CardHeader><CardTitle className="text-base">Sales by Restaurant</CardTitle></CardHeader><CardContent><ReportTable heads={["Restaurant","Orders","Sales","Profit"]}>{a.byRestaurant.map((r:any)=><TableRow key={r.name}><TableCell>{r.name}</TableCell><TableCell className="text-right">{r.orders}</TableCell><TableCell className="text-right">{formatCurrency(r.sales)}</TableCell><TableCell className="text-right">{formatCurrency(r.profit)}</TableCell></TableRow>)}</ReportTable></CardContent></Card>
  </div>;
}

function ReportTable({ heads, children }: { heads: string[]; children: React.ReactNode }) { return <div className="overflow-x-auto"><Table><TableHeader><TableRow>{heads.map((h,i)=><TableHead key={h} className={i >= heads.length-3 ? "text-right" : ""}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{children}</TableBody></Table></div>; }
function TotalRow({ span, label, value }: { span: number; label: string; value: number }) { return <TableRow className="bg-muted/40 font-semibold"><TableCell colSpan={span} className="text-right">{label}</TableCell><TableCell className="text-right">{formatCurrency(value)}</TableCell></TableRow>; }
