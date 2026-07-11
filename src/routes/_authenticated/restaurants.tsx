import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/restaurants")({
  component: RestaurantsPage,
});

type Restaurant = {
  id: string; name: string; contact_person: string | null; phone: string | null;
  address: string | null; email: string | null; credit_terms: string | null; is_active: boolean;
};

const emptyForm = { name: "", contact_person: "", phone: "", address: "", email: "", credit_terms: "", is_active: true };

function RestaurantsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Restaurant | null>(null);
  const [toDelete, setToDelete] = useState<Restaurant | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const { data, isLoading } = useQuery({
    queryKey: ["restaurants"],
    queryFn: async () => {
      const { data, error } = await supabase.from("restaurants").select("*").order("name");
      if (error) throw error;
      return data as Restaurant[];
    },
  });

  const filtered = useMemo(
    () => (data ?? []).filter((r) => r.name.toLowerCase().includes(search.toLowerCase())),
    [data, search],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name is required");
      const payload = { ...form, email: form.email || null };
      if (editing) {
        const { error } = await supabase.from("restaurants").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("restaurants").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["restaurants"] });
      setOpen(false);
      toast.success(editing ? "Restaurant updated" : "Restaurant added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("restaurants").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["restaurants"] });
      setToDelete(null);
      toast.success("Restaurant deleted");
    },
    onError: () => toast.error("Cannot delete: restaurant has sales history"),
  });

  const openNew = () => { setEditing(null); setForm({ ...emptyForm }); setOpen(true); };
  const openEdit = (r: Restaurant) => {
    setEditing(r);
    setForm({
      name: r.name, contact_person: r.contact_person ?? "", phone: r.phone ?? "",
      address: r.address ?? "", email: r.email ?? "", credit_terms: r.credit_terms ?? "", is_active: r.is_active,
    });
    setOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Restaurants"
        description="Your customer accounts"
        actions={<Button onClick={openNew}><Plus className="mr-1 h-4 w-4" />New Restaurant</Button>}
      />
      <Card className="p-4">
        <div className="relative mb-4 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search restaurants..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No restaurants found.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Terms</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <Link to="/restaurants/$id" params={{ id: r.id }} className="hover:text-primary hover:underline">{r.name}</Link>
                    </TableCell>
                    <TableCell>{r.contact_person || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{r.phone || "-"}</TableCell>
                    <TableCell>{r.credit_terms || "-"}</TableCell>
                    <TableCell>
                      {r.is_active
                        ? <Badge className="bg-success/15 text-success border border-success/30">Active</Badge>
                        : <Badge variant="secondary">Inactive</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" asChild><Link to="/restaurants/$id" params={{ id: r.id }}><ExternalLink className="h-4 w-4" /></Link></Button>
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
            <DialogTitle>{editing ? "Edit Restaurant" : "New Restaurant"}</DialogTitle>
            <DialogDescription>Customer account details.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-2"><Label>Contact Person</Label><Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
            <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-2"><Label>Credit Terms</Label><Input value={form.credit_terms} onChange={(e) => setForm({ ...form, credit_terms: e.target.value })} placeholder="e.g. Net 30" /></div>
            <div className="col-span-2 space-y-2"><Label>Address</Label><Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div className="col-span-2 flex items-center justify-between rounded-lg border border-border p-3">
              <div><Label>Active</Label><p className="text-xs text-muted-foreground">Inactive restaurants are hidden from new sales.</p></div>
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            </div>
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
        title="Delete restaurant?"
        description={`This will remove "${toDelete?.name}".`}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
      />
    </div>
  );
}