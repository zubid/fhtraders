import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Minus, Plus, Trash2, Loader2, Printer, ShoppingBag, Pencil, ShieldX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { METHOD_LABELS, PAYMENT_METHODS } from "@/lib/credit";
import { formatCurrency, formatNumber } from "@/lib/format";
import { printPosReceipt } from "@/lib/print";
import { PageHeader } from "@/components/app/PageHeader";
import { PosAdjustmentDialog } from "@/components/app/PosAdjustmentDialog";
import { AdjustmentReport } from "@/components/app/AdjustmentReport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/pos")({
  head: () => ({ meta: [{ title: "POS — FH Traders" }] }),
  component: PosPage,
});

type Product = { id: string; name: string; sku: string; unit: string; current_stock: number; default_selling_price: number; category_id: string | null };
type Line = { product_id: string; name: string; unit: string; stock: number; quantity: number; unit_price: number };

function PosPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [term, setTerm] = useState("");
  const [cat, setCat] = useState("all");
  const [cart, setCart] = useState<Line[]>([]);
  const [customer, setCustomer] = useState("");
  const [discount, setDiscount] = useState(0);
  const [method, setMethod] = useState("cash");
  const [vaultId, setVaultId] = useState("");
  const [tendered, setTendered] = useState<number | "">("");
  const submitting = useRef(false);

  const { data: products } = useQuery({
    queryKey: ["pos-products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("id,name,sku,unit,current_stock,default_selling_price,category_id").order("name");
      if (error) throw error;
      return data as Product[];
    },
  });
  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await supabase.from("categories").select("id,name").order("name")).data ?? [],
  });
  const { data: vaults } = useQuery({
    queryKey: ["pos-vaults"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("list_business_cash_vaults");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const filtered = useMemo(() => {
    let rows = products ?? [];
    if (cat !== "all") rows = rows.filter((p) => p.category_id === cat);
    if (term) {
      const s = term.toLowerCase();
      rows = rows.filter((p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s));
    }
    return rows;
  }, [products, cat, term]);

  const add = (p: Product) => {
    if (Number(p.current_stock) <= 0) return toast.error(`${p.name} is out of stock`);
    setCart((c) => {
      const ex = c.find((l) => l.product_id === p.id);
      if (ex) {
        if (ex.quantity + 1 > ex.stock) { toast.error(`Only ${formatNumber(ex.stock)} ${ex.unit} available`); return c; }
        return c.map((l) => (l.product_id === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...c, { product_id: p.id, name: p.name, unit: p.unit, stock: Number(p.current_stock), quantity: 1, unit_price: Number(p.default_selling_price) || 0 }];
    });
  };
  const update = (id: string, patch: Partial<Line>) => setCart((c) => c.map((l) => (l.product_id === id ? { ...l, ...patch } : l)));

  const subtotal = cart.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const grand = Math.max(0, subtotal - discount);
  const overStock = cart.filter((l) => l.quantity > l.stock || l.quantity <= 0);
  const change = tendered === "" ? 0 : Math.max(0, Number(tendered) - grand);

  const complete = useMutation({
    mutationFn: async () => {
      if (!cart.length) throw new Error("Cart is empty");
      if (overStock.length) throw new Error(`Invalid quantity for ${overStock[0].name}`);
      if (discount > subtotal) throw new Error("Discount exceeds subtotal");
      if (grand > 0 && !vaultId) throw new Error("Select the Business Cash Vault receiving the money");
      if (tendered !== "" && Number(tendered) < grand) throw new Error("Amount tendered is less than total");
      const { data, error } = await (supabase.rpc as any)("create_pos_sale", {
        p_items: cart.map((l) => ({ product_id: l.product_id, quantity: l.quantity, unit_price: l.unit_price })),
        p_customer_name: customer, p_discount: discount, p_method: method, p_vault_user_id: vaultId || null, p_note: null,
      });
      if (error) throw error;
      return data as { id: string; invoice_no: string };
    },
    onSuccess: async (res) => {
      toast.success(`Sale ${res.invoice_no} completed`);
      setCart([]); setCustomer(""); setDiscount(0); setTendered("");
      qc.invalidateQueries();
      await reprint(res.id);
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => { submitting.current = false; },
  });

  const reprint = async (id: string) => {
    const { data, error } = await supabase.from("sales").select("*, sale_items(quantity,unit_price,line_total,products(name,unit))").eq("id", id).single();
    if (error || !data) return toast.error("Could not load receipt");
    let cashier = "-";
    if ((data as any).created_by) {
      const { data: prof } = await supabase.from("profiles").select("full_name,email").eq("id", (data as any).created_by).maybeSingle();
      cashier = prof?.full_name || prof?.email || "-";
    }
    printPosReceipt({ ...data, cashier });
  };

  const onComplete = () => {
    if (submitting.current || complete.isPending) return;
    submitting.current = true;
    complete.mutate();
  };

  return (
    <div>
      <PageHeader title="POS" description={`Counter sales · ${user?.email ?? ""}`} />
      <Tabs defaultValue="sell">
        <TabsList className="mb-4"><TabsTrigger value="sell">Sell</TabsTrigger><TabsTrigger value="history">History</TabsTrigger><TabsTrigger value="audit">Adjustments & Returns</TabsTrigger></TabsList>
        <TabsContent value="sell">
          <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
            <Card className="p-4">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input autoFocus className="pl-9" placeholder="Search name or SKU..." value={term} onChange={(e) => setTerm(e.target.value)} />
                </div>
                <Select value={cat} onValueChange={setCat}>
                  <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {(categories ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid max-h-[70vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4">
                {filtered.map((p) => {
                  const out = Number(p.current_stock) <= 0;
                  return (
                    <button key={p.id} onClick={() => add(p)} disabled={out}
                      className="flex flex-col rounded-lg border border-border bg-card p-3 text-left transition hover:border-primary hover:shadow-sm disabled:opacity-50">
                      <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{p.sku}</span>
                      <span className="mt-2 font-semibold text-primary">{Number(p.default_selling_price) > 0 ? formatCurrency(p.default_selling_price) : "No price"}</span>
                      <span className={`text-xs ${out ? "text-destructive" : "text-muted-foreground"}`}>{out ? "Out of stock" : `${formatNumber(p.current_stock)} ${p.unit}`}</span>
                    </button>
                  );
                })}
                {!filtered.length && <div className="col-span-full py-12 text-center text-muted-foreground">No products found.</div>}
              </div>
            </Card>

            <Card className="flex flex-col p-4">
              <h3 className="mb-2 flex items-center gap-2 font-semibold"><ShoppingBag className="h-4 w-4" />Cart ({cart.length})</h3>
              <div className="max-h-[40vh] flex-1 space-y-2 overflow-y-auto">
                {!cart.length && <p className="py-8 text-center text-sm text-muted-foreground">Tap a product to add it.</p>}
                {cart.map((l) => {
                  const bad = l.quantity > l.stock || l.quantity <= 0;
                  return (
                    <div key={l.product_id} className={`rounded-md border p-2 ${bad ? "border-destructive" : "border-border"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium">{l.name}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setCart((c) => c.filter((x) => x.product_id !== l.product_id))}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => update(l.product_id, { quantity: Math.max(1, l.quantity - 1) })}><Minus className="h-3 w-3" /></Button>
                        <Input type="number" className="h-7 w-16 px-1 text-center" value={l.quantity} onChange={(e) => update(l.product_id, { quantity: Math.max(0, +e.target.value) })} />
                        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => update(l.product_id, { quantity: l.quantity + 1 })}><Plus className="h-3 w-3" /></Button>
                        <span className="mx-1 text-xs text-muted-foreground">×</span>
                        <Input type="number" min={0} className="h-7 w-24 px-1 text-right" value={l.unit_price} onChange={(e) => update(l.product_id, { unit_price: Math.max(0, +e.target.value) })} />
                        <span className="ml-auto text-sm font-semibold">{formatCurrency(l.quantity * l.unit_price)}</span>
                      </div>
                      {bad && <p className="mt-1 text-xs text-destructive">Available: {formatNumber(l.stock)} {l.unit}</p>}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 space-y-2 border-t border-border pt-3">
                <div className="space-y-1"><Label className="text-xs">Customer (optional)</Label><Input placeholder="Walk-in Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1"><Label className="text-xs">Method</Label>
                    <Select value={method} onValueChange={setMethod}><SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{METHOD_LABELS[m]}</SelectItem>)}</SelectContent></Select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Received in Vault</Label>
                    <Select value={vaultId} onValueChange={setVaultId}><SelectTrigger><SelectValue placeholder="Select vault" /></SelectTrigger>
                      <SelectContent>{(vaults ?? []).map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent></Select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Discount</Label><Input type="number" min={0} value={discount} onChange={(e) => setDiscount(Math.max(0, +e.target.value))} /></div>
                  <div className="space-y-1"><Label className="text-xs">Tendered (optional)</Label><Input type="number" min={0} value={tendered} onChange={(e) => setTendered(e.target.value === "" ? "" : Math.max(0, +e.target.value))} /></div>
                </div>
                <div className="flex justify-between text-sm"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
                {discount > 0 && <div className="flex justify-between text-sm"><span>Discount</span><span>-{formatCurrency(discount)}</span></div>}
                <div className="flex justify-between text-lg font-bold"><span>Total</span><span>{formatCurrency(grand)}</span></div>
                {tendered !== "" && <div className="flex justify-between text-sm text-muted-foreground"><span>Change</span><span>{formatCurrency(change)}</span></div>}
                <Button className="h-12 w-full text-base" onClick={onComplete} disabled={complete.isPending || !cart.length}>
                  {complete.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Complete Sale
                </Button>
              </div>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="history"><PosHistory onPrint={reprint} /></TabsContent><TabsContent value="audit"><AdjustmentReport /></TabsContent>
      </Tabs>
    </div>
  );
}

function PosHistory({ onPrint }: { onPrint: (id: string) => void }) {
  const [adjust,setAdjust]=useState<{sale:any;mode:"item_less"|"delete"}|null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["pos-history"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("sales") as any)
        .select("id,invoice_no,created_at,customer_name,grand_total,payment_method,created_by,is_voided,void_reason,source,restaurant_id,sale_items(id,product_id,quantity,unit_price,line_total,products(name,unit))")
        .order("created_at", { ascending: false }).limit(250);
      // Some Lovable-managed databases contain POS rows created before source tagging
      // was applied consistently. A POS sale is either explicitly tagged, or is a
      // walk-in sale with no restaurant and a POS payment method.
      const rows = (data ?? []).filter((s:any) => s.source === "pos" || (!s.restaurant_id && !!s.payment_method));
      if (error) throw error;
      const ids = [...new Set(rows.map((s: any) => s.created_by).filter(Boolean))] as string[];
      const { data: profs } = ids.length ? await supabase.from("profiles").select("id,full_name,email").in("id", ids) : { data: [] as any[] };
      const map = new Map((profs ?? []).map((p: any) => [p.id, p.full_name || p.email]));
      return rows.map((s: any) => ({ ...s, cashier: map.get(s.created_by) ?? "-" }));
    },
  });
  return (
    <Card className="p-4">
      {isLoading ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : !data?.length ? (
        <p className="py-12 text-center text-muted-foreground">No POS sales yet.</p>
      ) : (
        <div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Date/Time</TableHead><TableHead>Customer</TableHead><TableHead>Method</TableHead><TableHead>Cashier</TableHead><TableHead className="text-right">Total</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>{data.map((s: any) => (
            <TableRow key={s.id}>
              <TableCell className="font-mono text-xs">{s.invoice_no}</TableCell>
              <TableCell>{new Date(s.created_at).toLocaleString()}</TableCell>
              <TableCell>{s.customer_name || "Walk-in Customer"}</TableCell>
              <TableCell><Badge variant="secondary">{METHOD_LABELS[s.payment_method] ?? s.payment_method}</Badge></TableCell>
              <TableCell>{s.cashier}</TableCell>
              <TableCell className="text-right font-medium">{s.is_voided?<Badge variant="destructive">Deleted</Badge>:formatCurrency(s.grand_total)}</TableCell>
              <TableCell className="text-right"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" onClick={() => onPrint(s.id)} disabled={s.is_voided}><Printer className="h-4 w-4" /></Button><Button variant="ghost" size="icon" title="Edit / Item Less" onClick={()=>setAdjust({sale:s,mode:"item_less"})} disabled={s.is_voided}><Pencil className="h-4 w-4"/></Button><Button variant="ghost" size="icon" title="Delete POS Sale" onClick={()=>setAdjust({sale:s,mode:"delete"})} disabled={s.is_voided}><ShieldX className="h-4 w-4 text-destructive"/></Button></div></TableCell>
            </TableRow>
          ))}</TableBody>
        </Table></div>
      )}
      {adjust&&<PosAdjustmentDialog open={!!adjust} onOpenChange={(v)=>!v&&setAdjust(null)} sale={adjust.sale} mode={adjust.mode}/>} 
    </Card>
  );
}
