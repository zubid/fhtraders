import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Wallet, Eye, Trash2, HandCoins, Printer, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { formatCurrency, formatDate } from "@/lib/format";
import { printReport } from "@/lib/print";
import { downloadExcel } from "@/lib/xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/vault")({
  component: VaultPage,
});

const today = () => new Date().toISOString().slice(0, 10);

function VaultPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [topOpen, setTopOpen] = useState<null | { id: string; name: string }>(null);
  const [toDelete, setToDelete] = useState<any>(null);
  const [form, setForm] = useState({ name: "", phone: "", notes: "", opening_balance: 0 });
  const [top, setTop] = useState({ amount: 0, topup_date: today(), note: "" });

  const { data: users, isLoading } = useQuery({
    queryKey: ["vault_users"],
    queryFn: async () =>
      ((await (supabase.from("vault_users" as any) as any).select("*").order("name")).data ?? []) as any[],
  });
  const { data: topups } = useQuery({
    queryKey: ["vault_topups"],
    queryFn: async () =>
      ((await (supabase.from("vault_topups" as any) as any).select("*")).data ?? []) as any[],
  });
  const { data: purchases } = useQuery({
    queryKey: ["vault_purchases_all"],
    queryFn: async () =>
      ((await supabase.from("purchases").select("id,vault_user_id,amount_paid,grand_total,purchase_date") as any).data ?? []) as any[],
  });
  const { data: expenses } = useQuery({
    queryKey: ["vault_expenses_all"],
    queryFn: async () =>
      ((await supabase.from("expenses").select("id,vault_user_id,amount,expense_date") as any).data ?? []) as any[],
  });

  const computeBalance = (u: any) => {
    const tSum = (topups ?? []).filter((t) => t.vault_user_id === u.id).reduce((s, t) => s + Number(t.amount), 0);
    const pSum = (purchases ?? []).filter((p: any) => p.vault_user_id === u.id).reduce((s, p: any) => s + Number(p.amount_paid ?? 0), 0);
    const eSum = (expenses ?? []).filter((e: any) => e.vault_user_id === u.id).reduce((s, e: any) => s + Number(e.amount), 0);
    return Number(u.opening_balance) + tSum - pSum - eSum;
  };

  const totalOnHand = (users ?? []).reduce((s, u: any) => s + computeBalance(u), 0);
  const totalSpent = (purchases ?? []).filter((p: any) => p.vault_user_id).reduce((s, p: any) => s + Number(p.amount_paid ?? 0), 0)
    + (expenses ?? []).filter((e: any) => e.vault_user_id).reduce((s, e: any) => s + Number(e.amount), 0);

  const addUser = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Enter a name");
      const { error } = await (supabase.from("vault_users" as any) as any).insert({
        name: form.name.trim(), phone: form.phone || null, notes: form.notes || null,
        opening_balance: Number(form.opening_balance) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vault_users"] });
      setAddOpen(false); setForm({ name: "", phone: "", notes: "", opening_balance: 0 });
      toast.success("Vault user created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addTop = useMutation({
    mutationFn: async () => {
      if (!topOpen) return;
      if (Number(top.amount) <= 0) throw new Error("Enter an amount");
      const { data: u } = await supabase.auth.getUser();
      const { error } = await (supabase.from("vault_topups" as any) as any).insert({
        vault_user_id: topOpen.id, amount: Number(top.amount), topup_date: top.topup_date,
        note: top.note || null, created_by: u.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries();
      setTopOpen(null); setTop({ amount: 0, topup_date: today(), note: "" });
      toast.success("Top-up recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("vault_users" as any) as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries(); setToDelete(null); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rowsForExport = (users ?? []).map((u: any) => {
    const bal = computeBalance(u);
    const spentP = (purchases ?? []).filter((p: any) => p.vault_user_id === u.id).reduce((s, p: any) => s + Number(p.amount_paid ?? 0), 0);
    const spentE = (expenses ?? []).filter((e: any) => e.vault_user_id === u.id).reduce((s, e: any) => s + Number(e.amount), 0);
    const tSum = (topups ?? []).filter((t) => t.vault_user_id === u.id).reduce((s, t) => s + Number(t.amount), 0);
    return { u, bal, spentP, spentE, tSum };
  });

  const printAll = () => {
    printReport({
      title: "Vault Users Report",
      subtitle: `Generated ${formatDate(today())}`,
      columns: [
        { key: "name", label: "Name" },
        { key: "phone", label: "Phone" },
        { key: "opening", label: "Opening", align: "right" },
        { key: "topups", label: "Top-ups", align: "right" },
        { key: "purchases", label: "Purchases", align: "right" },
        { key: "expenses", label: "Expenses", align: "right" },
        { key: "balance", label: "Balance", align: "right" },
      ],
      rows: rowsForExport.map(({ u, bal, spentP, spentE, tSum }) => ({
        name: u.name, phone: u.phone ?? "-",
        opening: formatCurrency(u.opening_balance),
        topups: formatCurrency(tSum),
        purchases: formatCurrency(spentP),
        expenses: formatCurrency(spentE),
        balance: formatCurrency(bal),
      })),
      summary: [
        { label: "Total On Hand", value: formatCurrency(totalOnHand) },
        { label: "Total Spent (all vaults)", value: formatCurrency(totalSpent) },
      ],
    });
  };

  const exportExcel = () => {
    downloadExcel(
      `vault-users-${today()}`,
      ["Name", "Phone", "Opening", "Top-ups", "Purchases", "Expenses", "Balance"],
      rowsForExport.map(({ u, bal, spentP, spentE, tSum }) => [
        u.name, u.phone ?? "", Number(u.opening_balance).toFixed(2),
        tSum.toFixed(2), spentP.toFixed(2), spentE.toFixed(2), bal.toFixed(2),
      ]),
      "Vault Users",
    );
  };

  return (
    <div>
      <PageHeader
        title="Vault Users"
        description="Cash holders who buy stock or pay expenses"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportExcel}><FileSpreadsheet className="mr-1 h-4 w-4" />Excel</Button>
            <Button variant="outline" size="sm" onClick={printAll}><Printer className="mr-1 h-4 w-4" />PDF</Button>
            <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="mr-1 h-4 w-4" />Add Vault User</Button>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="flex items-center justify-between pt-6"><div><p className="text-sm text-muted-foreground">Vault Users</p><p className="mt-1 text-2xl font-bold">{(users ?? []).length}</p></div><Wallet className="h-8 w-8 text-primary" /></CardContent></Card>
        <Card><CardContent className="flex items-center justify-between pt-6"><div><p className="text-sm text-muted-foreground">Total On Hand</p><p className="mt-1 text-2xl font-bold text-success">{formatCurrency(totalOnHand)}</p></div><HandCoins className="h-8 w-8 text-success" /></CardContent></Card>
        <Card><CardContent className="flex items-center justify-between pt-6"><div><p className="text-sm text-muted-foreground">Spent via Vault</p><p className="mt-1 text-2xl font-bold text-destructive">{formatCurrency(totalSpent)}</p></div><Wallet className="h-8 w-8 text-destructive" /></CardContent></Card>
      </div>

      <Card className="p-4">
        {isLoading ? <Skeleton className="h-32 w-full" /> : (users ?? []).length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No vault users yet. Add one to start tracking cash-out.</div>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Name</TableHead><TableHead>Phone</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">Top-ups</TableHead>
              <TableHead className="text-right">Spent</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rowsForExport.map(({ u, bal, spentP, spentE, tSum }) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell>{u.phone ?? "-"}</TableCell>
                  <TableCell className="text-right">{formatCurrency(u.opening_balance)}</TableCell>
                  <TableCell className="text-right text-success">{formatCurrency(tSum)}</TableCell>
                  <TableCell className="text-right text-destructive">{formatCurrency(spentP + spentE)}</TableCell>
                  <TableCell className={`text-right font-bold ${bal < 0 ? "text-destructive" : ""}`}>{formatCurrency(bal)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" title="Top-up" onClick={() => setTopOpen({ id: u.id, name: u.name })}><HandCoins className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" asChild title="Details"><Link to="/vault/$id" params={{ id: u.id }}><Eye className="h-4 w-4" /></Link></Button>
                    <Button variant="ghost" size="icon" onClick={() => setToDelete(u)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Add user dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Vault User</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-2"><Label>Phone (optional)</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="space-y-2"><Label>Opening Balance</Label><Input type="number" step="0.01" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: +e.target.value })} /></div>
            <div className="space-y-2"><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => addUser.mutate()} disabled={addUser.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Top-up dialog */}
      <Dialog open={!!topOpen} onOpenChange={(v) => !v && setTopOpen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add funds to {topOpen?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Amount</Label><Input type="number" step="0.01" value={top.amount} onChange={(e) => setTop({ ...top, amount: +e.target.value })} /></div>
            <div className="space-y-2"><Label>Date</Label><Input type="date" value={top.topup_date} onChange={(e) => setTop({ ...top, topup_date: e.target.value })} /></div>
            <div className="space-y-2"><Label>Note</Label><Input value={top.note} onChange={(e) => setTop({ ...top, note: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopOpen(null)}>Cancel</Button>
            <Button onClick={() => addTop.mutate()} disabled={addTop.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title={`Delete vault user "${toDelete?.name}"?`}
        description="Their top-ups will be removed. Purchases and expenses will keep their history but lose the vault link."
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
      />
    </div>
  );
}