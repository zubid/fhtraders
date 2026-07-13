import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, Save, KeyRound, Users, Trash2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { useSettings } from "@/hooks/useSettings";
import { DEFAULT_BRANDING } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

const DATE_FORMATS = [
  { value: "dd MMM yyyy", label: "13 Jul 2026" },
  { value: "dd/MM/yyyy", label: "13/07/2026" },
  { value: "MM/dd/yyyy", label: "07/13/2026" },
  { value: "yyyy-MM-dd", label: "2026-07-13" },
];

function SettingsPage() {
  const { isAdmin, loading, user } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (!loading && !isAdmin) navigate({ to: "/dashboard", replace: true });
  }, [loading, isAdmin, navigate]);

  const [form, setForm] = useState({ ...DEFAULT_BRANDING });
  const [pw, setPw] = useState({ next: "", confirm: "" });
  const [wipeOpen, setWipeOpen] = useState(false);

  useEffect(() => { setForm({ ...DEFAULT_BRANDING, ...settings }); }, [settings.id]);

  const saveBranding = useMutation({
    mutationFn: async () => {
      const payload = {
        business_name: form.business_name || "StockFlow",
        business_tagline: form.business_tagline || "",
        logo_url: form.logo_url || null,
        address: form.address || null,
        phone: form.phone || null,
        email: form.email || null,
        currency_symbol: form.currency_symbol || "AED",
        date_format: form.date_format || "dd MMM yyyy",
        invoice_footer: form.invoice_footer || "",
      };
      if (settings.id) {
        const { error } = await supabase.from("app_settings").update(payload).eq("id", settings.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("app_settings").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["app_settings"] }); toast.success("Settings saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const onLogo = (file?: File) => {
    if (!file) return;
    if (file.size > 700_000) { toast.error("Logo must be under 700KB"); return; }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, logo_url: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  const changePw = useMutation({
    mutationFn: async () => {
      if (pw.next.length < 6) throw new Error("Password must be at least 6 characters");
      if (pw.next !== pw.confirm) throw new Error("Passwords do not match");
      const { error } = await supabase.auth.updateUser({ password: pw.next });
      if (error) throw error;
    },
    onSuccess: () => { setPw({ next: "", confirm: "" }); toast.success("Password updated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- user management ----
  const { data: users } = useQuery({
    queryKey: ["admin-users"],
    enabled: isAdmin,
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      const roleMap = new Map<string, string[]>();
      (roles ?? []).forEach((r: any) => {
        const arr = roleMap.get(r.user_id) ?? [];
        arr.push(r.role);
        roleMap.set(r.user_id, arr);
      });
      return (profiles ?? []).map((p: any) => ({
        ...p,
        role: (roleMap.get(p.id) ?? []).includes("admin") ? "admin" : "staff",
      }));
    },
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
      if (delErr) throw delErr;
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: role as "admin" | "staff" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); toast.success("Role updated"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const wipe = useMutation({
    mutationFn: async () => {
      const old = "1900-01-01";
      const tables = ["expenses", "payments", "sales", "purchases", "stock_movements", "products", "restaurants", "suppliers", "employees", "categories"];
      for (const t of tables) {
        const { error } = await supabase.from(t as any).delete().gte("created_at", old);
        if (error) throw new Error(`${t}: ${error.message}`);
      }
    },
    onSuccess: () => { qc.invalidateQueries(); setWipeOpen(false); toast.success("Demo data cleared"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) return null;

  return (
    <div>
      <PageHeader title="Settings" description="Business branding, security, users and data" />
      <Tabs defaultValue="branding">
        <TabsList>
          <TabsTrigger value="branding">Business</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>

        <TabsContent value="branding">
          <Card>
            <CardHeader><CardTitle className="text-base">Business Identity</CardTitle><CardDescription>Shown on the sidebar, browser tab and all printed documents.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                {form.logo_url ? <img src={form.logo_url} alt="logo" className="h-16 w-16 rounded-lg border border-border object-contain" /> : <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">No logo</div>}
                <div>
                  <input id="logo" type="file" accept="image/*" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} />
                  <Button variant="outline" size="sm" asChild><label htmlFor="logo" className="cursor-pointer"><Upload className="mr-1 h-4 w-4" />Upload Logo</label></Button>
                  {form.logo_url && <Button variant="ghost" size="sm" className="ml-2" onClick={() => setForm({ ...form, logo_url: null })}>Remove</Button>}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Business Name</Label><Input value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} /></div>
                <div className="space-y-2"><Label>Tagline</Label><Input value={form.business_tagline} onChange={(e) => setForm({ ...form, business_tagline: e.target.value })} /></div>
                <div className="space-y-2"><Label>Phone</Label><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div className="space-y-2"><Label>Email</Label><Input value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div className="space-y-2 sm:col-span-2"><Label>Address</Label><Input value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              </div>
              <Button onClick={() => saveBranding.mutate()} disabled={saveBranding.isPending}><Save className="mr-1 h-4 w-4" />Save</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preferences">
          <Card>
            <CardHeader><CardTitle className="text-base">App Preferences</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Currency Symbol</Label><Input value={form.currency_symbol} onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })} /></div>
                <div className="space-y-2">
                  <Label>Date Format</Label>
                  <Select value={form.date_format} onValueChange={(v) => setForm({ ...form, date_format: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{DATE_FORMATS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 sm:col-span-2"><Label>Invoice Footer Note</Label><Textarea value={form.invoice_footer} onChange={(e) => setForm({ ...form, invoice_footer: e.target.value })} /></div>
              </div>
              <Button onClick={() => saveBranding.mutate()} disabled={saveBranding.isPending}><Save className="mr-1 h-4 w-4" />Save</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <Card className="max-w-md">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4" />Change Password</CardTitle><CardDescription>Signed in as {user?.email}</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>New Password</Label><Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></div>
              <div className="space-y-2"><Label>Confirm Password</Label><Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></div>
              <Button onClick={() => changePw.mutate()} disabled={changePw.isPending}>Update Password</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />User Management</CardTitle><CardDescription>Assign admin or staff access.</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Change</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(users ?? []).map((u: any) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.full_name ?? "-"}</TableCell>
                      <TableCell>{u.email}</TableCell>
                      <TableCell><Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Select value={u.role} onValueChange={(v) => setRole.mutate({ userId: u.id, role: v })} disabled={u.id === user?.id}>
                          <SelectTrigger className="ml-auto w-32"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="staff">Staff</SelectItem></SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(users ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No users found.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data">
          <Card className="max-w-lg border-destructive/40">
            <CardHeader><CardTitle className="text-base flex items-center gap-2 text-destructive"><ShieldAlert className="h-4 w-4" />Danger Zone</CardTitle><CardDescription>Delete demo/dummy data to start fresh with real records.</CardDescription></CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">This permanently clears all purchases, sales, payments, expenses, products, restaurants, suppliers, employees, categories and stock history. Your account, roles and business settings are kept.</p>
              <Button variant="destructive" onClick={() => setWipeOpen(true)}><Trash2 className="mr-1 h-4 w-4" />Delete All Demo Data</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={wipeOpen}
        onOpenChange={setWipeOpen}
        title="Delete all demo data?"
        description="This cannot be undone. All transactional and catalog data will be removed."
        confirmLabel="Delete everything"
        onConfirm={() => wipe.mutate()}
      />
    </div>
  );
}
