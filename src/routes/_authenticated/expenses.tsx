import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Wallet, Users, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { formatCurrency, formatDate } from "@/lib/format";
import { printReport } from "@/lib/print";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/expenses")({
  component: ExpensesPage,
});

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

function ExpensesPage() {
  const qc = useQueryClient();
  const [from, setFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(today());
  const [genOpen, setGenOpen] = useState(false);
  const [salOpen, setSalOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [toDelete, setToDelete] = useState<any>(null);

  const [gen, setGen] = useState({ expense_date: today(), category_id: "", amount: 0, description: "", vault_user_id: "" });
  const [sal, setSal] = useState({ expense_date: today(), employee_id: "", salary_month: thisMonth(), amount: 0, description: "", vault_user_id: "" });
  const [catName, setCatName] = useState("");
  const [vaultFilter, setVaultFilter] = useState<string>("all");

  const { data: cats } = useQuery({
    queryKey: ["expense_categories"],
    queryFn: async () => (await supabase.from("expense_categories").select("*").order("name")).data ?? [],
  });
  const { data: vaultUsers } = useQuery({
    queryKey: ["vault_users_active"],
    queryFn: async () =>
      ((await (supabase.from("vault_users" as any) as any).select("id,name").eq("is_active", true).order("name")).data ?? []) as any[],
  });
  const { data: employees } = useQuery({
    queryKey: ["employees-active"],
    queryFn: async () => (await supabase.from("employees").select("id,name,monthly_salary").eq("is_active", true).order("name")).data ?? [],
  });
  const { data: expenses, isLoading } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () =>
      (await supabase
        .from("expenses")
        .select("*, expense_categories(name), employees(name), vault_users(name)")
        .order("expense_date", { ascending: false })).data ?? [],
  });

  const inRange = (e: any) => e.expense_date >= from && e.expense_date <= to;
  const filtered = useMemo(
    () => (expenses ?? []).filter((e: any) => inRange(e) && (vaultFilter === "all" ? true : vaultFilter === "none" ? !e.vault_user_id : e.vault_user_id === vaultFilter)),
    [expenses, from, to, vaultFilter],
  );
  const general = filtered.filter((e: any) => e.type === "general");
  const salaries = filtered.filter((e: any) => e.type === "salary");
  const totalGeneral = general.reduce((s: number, e: any) => s + Number(e.amount), 0);
  const totalSalary = salaries.reduce((s: number, e: any) => s + Number(e.amount), 0);

  const addGeneral = useMutation({
    mutationFn: async () => {
      if (Number(gen.amount) <= 0) throw new Error("Enter an amount");
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("expenses").insert({
        type: "general", expense_date: gen.expense_date, category_id: gen.category_id || null,
        amount: Number(gen.amount), description: gen.description || null, created_by: u.user?.id ?? null,
        vault_user_id: gen.vault_user_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries(); setGenOpen(false); toast.success("Expense added"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addSalary = useMutation({
    mutationFn: async () => {
      if (!sal.employee_id) throw new Error("Select an employee");
      if (Number(sal.amount) <= 0) throw new Error("Enter an amount");
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("expenses").insert({
        type: "salary", expense_date: sal.expense_date, employee_id: sal.employee_id,
        salary_month: sal.salary_month, amount: Number(sal.amount), description: sal.description || null,
        created_by: u.user?.id ?? null,
        vault_user_id: sal.vault_user_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries(); setSalOpen(false); toast.success("Salary recorded"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addCat = useMutation({
    mutationFn: async () => {
      if (!catName.trim()) throw new Error("Enter a name");
      const { error } = await supabase.from("expense_categories").insert({ name: catName.trim() });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expense_categories"] }); setCatName(""); setCatOpen(false); toast.success("Category added"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("expenses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expenses"] }); setToDelete(null); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const openGeneral = () => { setGen({ expense_date: today(), category_id: "", amount: 0, description: "", vault_user_id: "" }); setGenOpen(true); };
  const openSalary = () => { setSal({ expense_date: today(), employee_id: "", salary_month: thisMonth(), amount: 0, description: "", vault_user_id: "" }); setSalOpen(true); };

  const printExpenses = () => {
    printReport({
      title: "Expenses Report",
      subtitle: `${formatDate(from)} to ${formatDate(to)}`,
      columns: [
        { key: "date", label: "Date" },
        { key: "type", label: "Type" },
        { key: "ref", label: "Category / Employee" },
        { key: "desc", label: "Description" },
        { key: "amount", label: "Amount", align: "right" },
      ],
      rows: filtered.map((e: any) => ({
        date: formatDate(e.expense_date),
        type: e.type === "salary" ? "Salary" : "General",
        ref: e.type === "salary" ? e.employees?.name ?? "—" : e.expense_categories?.name ?? "—",
        desc: e.description ?? "",
        amount: formatCurrency(e.amount),
      })),
      summary: [
        { label: "General Expenses", value: formatCurrency(totalGeneral) },
        { label: "Salaries", value: formatCurrency(totalSalary) },
        { label: "Total Expenses", value: formatCurrency(totalGeneral + totalSalary) },
      ],
    });
  };

  return (
    <div>
      <PageHeader
        title="Expenses & Payroll"
        description="Track general expenses and monthly salaries"
        actions={<Button variant="outline" onClick={printExpenses}><Printer className="mr-1 h-4 w-4" />Print Report</Button>}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div><Label className="text-xs text-muted-foreground">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label className="text-xs text-muted-foreground">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="min-w-[180px]">
          <Label className="text-xs text-muted-foreground">By Vault User</Label>
          <Select value={vaultFilter} onValueChange={setVaultFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="none">No vault user</SelectItem>
              {(vaultUsers ?? []).map((v: any) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="flex items-center justify-between pt-6"><div><p className="text-sm text-muted-foreground">General Expenses</p><p className="mt-1 text-2xl font-bold">{formatCurrency(totalGeneral)}</p></div><Wallet className="h-8 w-8 text-chart-5" /></CardContent></Card>
        <Card><CardContent className="flex items-center justify-between pt-6"><div><p className="text-sm text-muted-foreground">Salaries</p><p className="mt-1 text-2xl font-bold">{formatCurrency(totalSalary)}</p></div><Users className="h-8 w-8 text-accent-foreground" /></CardContent></Card>
        <Card><CardContent className="flex items-center justify-between pt-6"><div><p className="text-sm text-muted-foreground">Total Expenses</p><p className="mt-1 text-2xl font-bold text-destructive">{formatCurrency(totalGeneral + totalSalary)}</p></div><Wallet className="h-8 w-8 text-destructive" /></CardContent></Card>
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General Expenses</TabsTrigger>
          <TabsTrigger value="salary">Salaries</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Card className="p-4">
            <div className="mb-3 flex justify-end"><Button size="sm" onClick={openGeneral}><Plus className="mr-1 h-4 w-4" />Add Expense</Button></div>
            {isLoading ? <Skeleton className="h-32 w-full" /> : general.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">No general expenses in this range.</div>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Category</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {general.map((e: any) => (
                    <TableRow key={e.id}>
                      <TableCell>{formatDate(e.expense_date)}</TableCell>
                      <TableCell>{e.expense_categories?.name ?? "-"}</TableCell>
                      <TableCell>{e.description ?? "-"}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(e.amount)}</TableCell>
                      <TableCell className="text-right"><Button variant="ghost" size="icon" onClick={() => setToDelete(e)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="salary">
          <Card className="p-4">
            <div className="mb-3 flex justify-end"><Button size="sm" onClick={openSalary}><Plus className="mr-1 h-4 w-4" />Record Salary</Button></div>
            {isLoading ? <Skeleton className="h-32 w-full" /> : salaries.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">No salary payments in this range.</div>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Employee</TableHead><TableHead>Month</TableHead><TableHead>Note</TableHead><TableHead className="text-right">Amount</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {salaries.map((e: any) => (
                    <TableRow key={e.id}>
                      <TableCell>{formatDate(e.expense_date)}</TableCell>
                      <TableCell className="font-medium">{e.employees?.name ?? "-"}</TableCell>
                      <TableCell>{e.salary_month ?? "-"}</TableCell>
                      <TableCell>{e.description ?? "-"}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(e.amount)}</TableCell>
                      <TableCell className="text-right"><Button variant="ghost" size="icon" onClick={() => setToDelete(e)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="categories">
          <Card className="p-4">
            <div className="mb-3 flex justify-end"><Button size="sm" onClick={() => setCatOpen(true)}><Plus className="mr-1 h-4 w-4" />Add Category</Button></div>
            <div className="flex flex-wrap gap-2">
              {(cats ?? []).map((c: any) => (
                <span key={c.id} className="rounded-full border border-border px-3 py-1 text-sm" style={{ borderColor: c.color }}>{c.name}</span>
              ))}
              {(cats ?? []).length === 0 && <p className="text-muted-foreground">No categories yet.</p>}
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* General expense dialog */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add General Expense</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Date</Label><Input type="date" value={gen.expense_date} onChange={(e) => setGen({ ...gen, expense_date: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={gen.category_id} onValueChange={(v) => setGen({ ...gen, category_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>{(cats ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Amount</Label><Input type="number" step="0.01" value={gen.amount} onChange={(e) => setGen({ ...gen, amount: +e.target.value })} /></div>
            <div className="space-y-2"><Label>Description</Label><Input value={gen.description} onChange={(e) => setGen({ ...gen, description: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setGenOpen(false)}>Cancel</Button><Button onClick={() => addGeneral.mutate()} disabled={addGeneral.isPending}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Salary dialog */}
      <Dialog open={salOpen} onOpenChange={setSalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record Salary Payment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Employee</Label>
              <Select value={sal.employee_id} onValueChange={(v) => {
                const emp = (employees ?? []).find((e: any) => e.id === v);
                setSal({ ...sal, employee_id: v, amount: Number(emp?.monthly_salary ?? 0) });
              }}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>{(employees ?? []).map((e: any) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Pay Date</Label><Input type="date" value={sal.expense_date} onChange={(e) => setSal({ ...sal, expense_date: e.target.value })} /></div>
              <div className="space-y-2"><Label>Salary Month</Label><Input type="month" value={sal.salary_month} onChange={(e) => setSal({ ...sal, salary_month: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Amount</Label><Input type="number" step="0.01" value={sal.amount} onChange={(e) => setSal({ ...sal, amount: +e.target.value })} /></div>
            <div className="space-y-2"><Label>Note</Label><Input value={sal.description} onChange={(e) => setSal({ ...sal, description: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setSalOpen(false)}>Cancel</Button><Button onClick={() => addSalary.mutate()} disabled={addSalary.isPending}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category dialog */}
      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Expense Category</DialogTitle></DialogHeader>
          <div className="space-y-2"><Label>Name</Label><Input value={catName} onChange={(e) => setCatName(e.target.value)} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setCatOpen(false)}>Cancel</Button><Button onClick={() => addCat.mutate()} disabled={addCat.isPending}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Delete entry?"
        description="This permanently removes the expense record."
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
      />
    </div>
  );
}
