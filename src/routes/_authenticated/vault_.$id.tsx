import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { formatCurrency, formatDate } from "@/lib/format";
import { printReport } from "@/lib/print";
import { downloadExcel } from "@/lib/xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/vault_/$id")({
  component: VaultDetail,
});

function VaultDetail() {
  const { id } = Route.useParams();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: user } = useQuery({
    queryKey: ["vault_user", id],
    queryFn: async () =>
      (await (supabase.from("vault_users" as any) as any).select("*").eq("id", id).maybeSingle()).data,
  });
  const { data: topups } = useQuery({
    queryKey: ["vault_topups", id],
    queryFn: async () =>
      ((await (supabase.from("vault_topups" as any) as any).select("*").eq("vault_user_id", id).order("topup_date", { ascending: false })).data ?? []) as any[],
  });
  const { data: purchases } = useQuery({
    queryKey: ["vault_purchases", id],
    queryFn: async () =>
      ((await supabase.from("purchases").select("id,reference_no,purchase_date,grand_total,amount_paid,suppliers(name)").eq("vault_user_id" as any, id).order("purchase_date", { ascending: false }) as any).data ?? []) as any[],
  });
  const { data: expenses } = useQuery({
    queryKey: ["vault_expenses", id],
    queryFn: async () =>
      ((await supabase.from("expenses").select("id,expense_date,type,amount,description,expense_categories(name),employees(name)").eq("vault_user_id" as any, id).order("expense_date", { ascending: false }) as any).data ?? []) as any[],
  });
  const { data: custPay } = useQuery({
    queryKey: ["vault_cust_pay", id],
    queryFn: async () =>
      ((await (supabase.from("payments") as any).select("id,payment_date,amount,note,method,restaurants(name)").eq("vault_user_id", id).order("payment_date", { ascending: false })).data ?? []) as any[],
  });
  const { data: supPay } = useQuery({
    queryKey: ["vault_sup_pay", id],
    queryFn: async () =>
      ((await (supabase.from("supplier_payments" as any) as any).select("id,payment_date,amount,note,method,suppliers(name)").eq("vault_user_id", id).order("payment_date", { ascending: false })).data ?? []) as any[],
  });

  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);
  const fTop = useMemo(() => (topups ?? []).filter((t) => inRange(t.topup_date)), [topups, from, to]);
  const fPur = useMemo(() => (purchases ?? []).filter((p: any) => inRange(p.purchase_date)), [purchases, from, to]);
  const fExp = useMemo(() => (expenses ?? []).filter((e: any) => inRange(e.expense_date)), [expenses, from, to]);
  const fCP = useMemo(() => (custPay ?? []).filter((c: any) => inRange(c.payment_date)), [custPay, from, to]);
  const fSP = useMemo(() => (supPay ?? []).filter((s: any) => inRange(s.payment_date)), [supPay, from, to]);

  const sumTop = fTop.reduce((s, t) => s + Number(t.amount), 0);
  const sumPur = fPur.reduce((s: number, p: any) => s + Number(p.amount_paid ?? 0), 0);
  const sumExp = fExp.reduce((s: number, e: any) => s + Number(e.amount), 0);
  const sumCP = fCP.reduce((s: number, c: any) => s + Number(c.amount), 0);
  const sumSP = fSP.reduce((s: number, x: any) => s + Number(x.amount), 0);
  const opening = Number(user?.opening_balance ?? 0);
  const balance = opening + sumTop + sumCP - sumPur - sumExp - sumSP;

  const ledger = useMemo(() => {
    const rows: any[] = [];
    fTop.forEach((t) => rows.push({ date: t.topup_date, kind: "Top-up", ref: t.note ?? "-", inflow: Number(t.amount), outflow: 0 }));
    fCP.forEach((c: any) => rows.push({ date: c.payment_date, kind: "Received", ref: c.restaurants?.name ?? c.note ?? "-", inflow: Number(c.amount), outflow: 0 }));
    fPur.forEach((p: any) => rows.push({ date: p.purchase_date, kind: "Purchase", ref: `${p.reference_no} · ${p.suppliers?.name ?? ""}`, inflow: 0, outflow: Number(p.amount_paid ?? 0) }));
    fSP.forEach((s: any) => rows.push({ date: s.payment_date, kind: "Supplier Pay", ref: s.suppliers?.name ?? "-", inflow: 0, outflow: Number(s.amount) }));
    fExp.forEach((e: any) => rows.push({ date: e.expense_date, kind: e.type === "salary" ? "Salary" : "Expense", ref: e.type === "salary" ? (e.employees?.name ?? "-") : (e.expense_categories?.name ?? e.description ?? "-"), inflow: 0, outflow: Number(e.amount) }));
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    return rows;
  }, [fTop, fPur, fExp, fCP, fSP]);

  const rangeLabel = `${from ? formatDate(from) : "start"} → ${to ? formatDate(to) : "today"}`;

  const printPdf = () => {
    printReport({
      title: `Vault Statement — ${user?.name ?? ""}`,
      subtitle: rangeLabel,
      columns: [
        { key: "date", label: "Date" },
        { key: "kind", label: "Type" },
        { key: "ref", label: "Reference" },
        { key: "inflow", label: "In", align: "right" },
        { key: "outflow", label: "Out", align: "right" },
      ],
      rows: ledger.map((r) => ({
        date: formatDate(r.date), kind: r.kind, ref: r.ref,
        inflow: r.inflow ? formatCurrency(r.inflow) : "-",
        outflow: r.outflow ? formatCurrency(r.outflow) : "-",
      })),
      summary: [
        { label: "Opening", value: formatCurrency(opening) },
        { label: "Top-ups", value: formatCurrency(sumTop) },
        { label: "Purchases", value: formatCurrency(sumPur) },
        { label: "Expenses", value: formatCurrency(sumExp) },
        { label: "Balance", value: formatCurrency(balance) },
      ],
    });
  };

  const exportExcel = () => {
    downloadExcel(
      `vault-${user?.name?.replace(/\s+/g, "_") ?? "user"}-${new Date().toISOString().slice(0, 10)}`,
      ["Date", "Type", "Reference", "In", "Out"],
      ledger.map((r) => [formatDate(r.date), r.kind, r.ref, r.inflow || "", r.outflow || ""]),
      `${user?.name ?? ""} · ${rangeLabel}`,
    );
  };

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/vault"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link></Button>
      <PageHeader
        title={user?.name ?? "Vault User"}
        description={user?.phone ?? user?.notes ?? "Cash ledger"}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportExcel}><FileSpreadsheet className="mr-1 h-4 w-4" />Excel</Button>
            <Button variant="outline" size="sm" onClick={printPdf}><Printer className="mr-1 h-4 w-4" />PDF</Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div><Label className="text-xs text-muted-foreground">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label className="text-xs text-muted-foreground">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        {(from || to) && <Button variant="ghost" onClick={() => { setFrom(""); setTo(""); }}>Clear</Button>}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-5">
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Opening</p><p className="mt-1 text-lg font-bold">{formatCurrency(opening)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Top-ups</p><p className="mt-1 text-lg font-bold text-success">{formatCurrency(sumTop)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Purchases</p><p className="mt-1 text-lg font-bold text-destructive">{formatCurrency(sumPur)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Expenses</p><p className="mt-1 text-lg font-bold text-destructive">{formatCurrency(sumExp)}</p></CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Balance</p><p className={`mt-1 text-lg font-bold ${balance < 0 ? "text-destructive" : ""}`}>{formatCurrency(balance)}</p></CardContent></Card>
      </div>

      <Tabs defaultValue="ledger">
        <TabsList>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="purchases">Purchases</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="topups">Top-ups</TabsTrigger>
        </TabsList>

        <TabsContent value="ledger">
          <Card className="p-4">
            {ledger.length === 0 ? <div className="py-10 text-center text-muted-foreground">No activity in this range.</div> : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">In</TableHead><TableHead className="text-right">Out</TableHead></TableRow></TableHeader>
                <TableBody>{ledger.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{formatDate(r.date)}</TableCell>
                    <TableCell>{r.kind}</TableCell>
                    <TableCell>{r.ref}</TableCell>
                    <TableCell className="text-right text-success">{r.inflow ? formatCurrency(r.inflow) : "-"}</TableCell>
                    <TableCell className="text-right text-destructive">{r.outflow ? formatCurrency(r.outflow) : "-"}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="purchases">
          <Card className="p-4">
            {fPur.length === 0 ? <div className="py-10 text-center text-muted-foreground">No purchases.</div> : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Ref</TableHead><TableHead>Supplier</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid from Vault</TableHead></TableRow></TableHeader>
                <TableBody>{fPur.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell>{formatDate(p.purchase_date)}</TableCell>
                    <TableCell className="font-mono text-xs">{p.reference_no}</TableCell>
                    <TableCell>{p.suppliers?.name ?? "-"}</TableCell>
                    <TableCell className="text-right">{formatCurrency(p.grand_total)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(p.amount_paid ?? 0)}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="expenses">
          <Card className="p-4">
            {fExp.length === 0 ? <div className="py-10 text-center text-muted-foreground">No expenses.</div> : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>{fExp.map((e: any) => (
                  <TableRow key={e.id}>
                    <TableCell>{formatDate(e.expense_date)}</TableCell>
                    <TableCell>{e.type === "salary" ? "Salary" : "General"}</TableCell>
                    <TableCell>{e.type === "salary" ? (e.employees?.name ?? "-") : (e.expense_categories?.name ?? e.description ?? "-")}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(e.amount)}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="topups">
          <Card className="p-4">
            {fTop.length === 0 ? <div className="py-10 text-center text-muted-foreground">No top-ups.</div> : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Note</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>{fTop.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{formatDate(t.topup_date)}</TableCell>
                    <TableCell>{t.note ?? "-"}</TableCell>
                    <TableCell className="text-right font-medium text-success">{formatCurrency(t.amount)}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}