import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search, ExternalLink, HandCoins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { PaySupplierDialog } from "@/components/app/PaySupplierDialog";
import { purchaseBalance } from "@/lib/supplier-credit";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/suppliers")({
  component: SuppliersPage,
});

type Supplier = {
  id: string; name: string; contact_person: string | null; phone: string | null;
  address: string | null; email: string | null;
};

const emptyForm = { name: "", contact_person: "", phone: "", address: "", email: "" };

function SuppliersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [onlyOutstanding, setOnlyOutstanding] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [toDelete, setToDelete] = useState<Supplier | null>(null);
  const [payFor, setPayFor] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const { data, isLoading } = useQuery({
    queryKey: ["suppliers-full"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").order("name");
      if (error) throw error;
      return data as Supplier[];
    },
  });

  const { data: purchases } = useQuery({
    queryKey: ["purchases-balances"],
    queryFn: async () =>
      (await supabase.from("purchases").select("supplier_id,grand_total,amount_paid")).data ?? [],
  });

  const balances = useMemo(() => {
    const map = new Map<string, number>();
    (purchases ?? []).forEach((p: any) => {
      if (!p.supplier_id) return;
      map.set(p.supplier_id, (map.get(p.supplier_id) ?? 0) + purchaseBalance(p));
    });
    return map;
  }, [purchases]);

  const filtered = useMemo(
    () =>
      (data ?? [])
        .filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
        .filter((r) => (onlyOutstanding ? (balances.get(r.id) ?? 0) > 0.001 : true))
        .sort((a, b) => (balances.get(b.id) ?? 0) - (balances.get(a.id) ?? 0)),
    [data, search, onlyOutstanding, balances],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name is required");
      const payload = { ...form, email: form.email || null };
      if (editing) {
        const { error } = await supabase.from("suppliers").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("suppliers").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers-full"] });
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      setOpen(false);
      toast.success(editing ? "Supplier updated" : "Supplier added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("suppliers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries();
      setToDelete(null);
      toast.success("Supplier deleted");
    },
    onError: () => toast.error("Cannot delete: supplier has purchase history"),
  });

  const openNew = () => { setEditing(null); setForm({ ...emptyForm }); setOpen(true); };
  const openEdit = (r: Supplier) => {
    setEditing(r);
    setForm({
      name: r.name, contact_person: r.contact_person ?? "", phone: r.phone ?? "",
      address: r.address ?? "", email: r.email ?? "",
    });
    setOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Vendors you buy stock from"
        actions={<Button onClick={openNew}><Plus className="mr-1 h-4 w-4" />New Supplier</Button>}
      />
      <Card className="p-4">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search suppliers..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Button variant={onlyOutstanding ? "default" : "outline"} size="sm" onClick={() => setOnlyOutstanding((v) => !v)}>
            Payable only
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No suppliers found.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead className="text-right">Payable</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <Link to="/suppliers/$id" params={{ id: r.id }} className="hover:text-primary hover:underline">{r.name}</Link>
                    </TableCell>
                    <TableCell>{r.contact_person || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{r.phone || "-"}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">{r.address || "-"}</TableCell>
                    <TableCell className="text-right">
                      {(balances.get(r.id) ?? 0) > 0.001
                        ? <Badge className="bg-destructive/15 text-destructive border border-destructive/30">{formatCurrency(balances.get(r.id) ?? 0)}</Badge>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {(balances.get(r.id) ?? 0) > 0.001 && (
                        <Button variant="ghost" size="icon" title="Pay supplier" onClick={() => setPayFor(r)}><HandCoins className="h-4 w-4" /></Button>
                      )}
                      <Button variant="ghost" size="icon" asChild><Link to="/suppliers/$id" params={{ id: r.id }}><ExternalLink className="h-4 w-4" /></Link></Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setToDelete(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Supplier" : "New Supplier"}</DialogTitle>
            <DialogDescription>Only name is required — contact details are optional.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-2"><Label>Contact Person</Label><Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
            <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="col-span-2 space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="col-span-2 space-y-2"><Label>Address</Label><Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Delete supplier?"
        description={`This will remove "${toDelete?.name}".`}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
      />

      {payFor && (
        <PaySupplierDialog
          open={!!payFor}
          onOpenChange={(v) => !v && setPayFor(null)}
          supplierId={payFor.id}
          supplierName={payFor.name}
        />
      )}
    </div>
  );
}