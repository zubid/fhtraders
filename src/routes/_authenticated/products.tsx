import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search, ArrowUpDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { StockBadge } from "@/components/app/StockBadge";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/products")({
  component: ProductsPage,
});

const UNITS = ["kg", "g", "litre", "ml", "pcs", "box", "pack", "dozen"];
const OTHER_UNIT = "__other__";

type Product = {
  id: string; name: string; category_id: string | null; unit: string; sku: string;
  reorder_level: number; max_stock_level: number; current_stock: number; avg_cost: number;
  default_purchase_price: number; default_selling_price: number;
  categories?: { name: string; color: string } | null;
};

const emptyForm = {
  name: "", category_id: "", unit: "pcs", reorder_level: 0, max_stock_level: 0,
};

function ProductsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [sortKey, setSortKey] = useState<"name" | "current_stock">("name");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [toDelete, setToDelete] = useState<Product | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("id,name,default_unit").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, categories(name,color)")
        .order("name");
      if (error) throw error;
      return data as Product[];
    },
  });

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (catFilter !== "all") rows = rows.filter((p) => p.category_id === catFilter);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s));
    }
    return [...rows].sort((a, b) =>
      sortKey === "name" ? a.name.localeCompare(b.name) : a.current_stock - b.current_stock,
    );
  }, [data, catFilter, search, sortKey]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name is required");
      const payload = {
        name: form.name,
        category_id: form.category_id || null,
        unit: form.unit,
        reorder_level: Number(form.reorder_level),
        max_stock_level: Number(form.max_stock_level),
      };
      if (editing) {
        const { error } = await supabase.from("products").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      setOpen(false);
      toast.success(editing ? "Product updated" : "Product created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      setToDelete(null);
      toast.success("Product deleted");
    },
    onError: () => toast.error("Cannot delete: product is used in transactions"),
  });

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setOpen(true);
  };
  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name, category_id: p.category_id ?? "", unit: p.unit,
      reorder_level: p.reorder_level, max_stock_level: p.max_stock_level,
    });
    setOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Products"
        description="Manage your product catalog and stock levels"
        actions={<Button onClick={openNew}><Plus className="mr-1 h-4 w-4" />New Product</Button>}
      />
      <Card className="p-4">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by name or SKU..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger className="sm:w-48"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {(categories ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => setSortKey(sortKey === "name" ? "current_stock" : "name")}>
            <ArrowUpDown className="mr-1 h-4 w-4" />Sort: {sortKey === "name" ? "Name" : "Stock"}
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">No products found.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{p.sku}</TableCell>
                    <TableCell>{p.categories?.name ?? "-"}</TableCell>
                    <TableCell className="text-right">{formatNumber(p.current_stock)} {p.unit}</TableCell>
                    <TableCell><StockBadge current={p.current_stock} reorder={p.reorder_level} max={p.max_stock_level} /></TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setToDelete(p)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
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
            <DialogTitle>{editing ? "Edit Product" : "New Product"}</DialogTitle>
            <DialogDescription>SKU is auto-generated. Stock updates automatically from purchases and sales.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={form.category_id} onValueChange={(v) => {
                const cat = (categories ?? []).find((c) => c.id === v);
                setForm({ ...form, category_id: v, unit: cat?.default_unit ?? form.unit });
              }}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{(categories ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Unit</Label>
              <Select
                value={UNITS.includes(form.unit) ? form.unit : OTHER_UNIT}
                onValueChange={(v) => setForm({ ...form, unit: v === OTHER_UNIT ? "" : v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  <SelectItem value={OTHER_UNIT}>Other (custom)…</SelectItem>
                </SelectContent>
              </Select>
              {!UNITS.includes(form.unit) && (
                <Input className="mt-2" placeholder="Type a custom unit (e.g. bottle, bag)"
                  value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
              )}
            </div>
            <div className="space-y-2">
              <Label>Reorder Level (low)</Label>
              <Input type="number" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: +e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Max Stock (high)</Label>
              <Input type="number" value={form.max_stock_level} onChange={(e) => setForm({ ...form, max_stock_level: +e.target.value })} />
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
        title="Delete product?"
        description={`This will remove "${toDelete?.name}".`}
        onConfirm={() => toDelete && del.mutate(toDelete.id)}
      />
    </div>
  );
}