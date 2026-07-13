import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, ShoppingCart, DollarSign, Percent, Package, Store, AlertTriangle, Wallet, PiggyBank, CreditCard } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { RangePicker } from "@/components/app/RangePicker";
import { useAuth } from "@/hooks/useAuth";
import { useAnalytics, useDateRange } from "@/lib/useAnalytics";
import { formatCurrency, formatNumber, stockStatus } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Kpi({ title, value, icon, accent }: { title: string; value: string; icon: ReactNode; accent?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between pt-6">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-bold">{value}</p>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${accent ?? "bg-primary/10 text-primary"}`}>{icon}</div>
      </CardContent>
    </Card>
  );
}

function Dashboard() {
  const { isAdmin } = useAuth();
  const { preset, setPreset, custom, setCustom, range } = useDateRange("month");
  const a = useAnalytics(range.from, range.to);

  const { data: products } = useQuery({
    queryKey: ["dash-products"],
    queryFn: async () => (await supabase.from("products").select("current_stock,reorder_level,max_stock_level")).data ?? [],
  });
  const lowCount = (products ?? []).filter((p: any) => ["low", "out"].includes(stockStatus(p.current_stock, p.reorder_level, p.max_stock_level))).length;

  return (
    <div>
      <PageHeader title="Dashboard" description={`Overview · ${range.from} to ${range.to}`} />
      <div className="mb-6"><RangePicker preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} /></div>

      {a.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi title="Total Sales" value={formatCurrency(a.totalSales)} icon={<TrendingUp className="h-5 w-5" />} accent="bg-success/10 text-success" />
          <Kpi title="Total Purchases" value={formatCurrency(a.totalPurchases)} icon={<ShoppingCart className="h-5 w-5" />} accent="bg-chart-5/10 text-chart-5" />
          {isAdmin ? (
            <>
              <Kpi title="Gross Profit" value={formatCurrency(a.grossProfit)} icon={<DollarSign className="h-5 w-5" />} accent="bg-accent/20 text-accent-foreground" />
              <Kpi title="Profit Margin" value={`${formatNumber(a.margin, 1)}%`} icon={<Percent className="h-5 w-5" />} />
            </>
          ) : (
            <>
              <Kpi title="Orders" value={String(a.orders)} icon={<Store className="h-5 w-5" />} accent="bg-accent/20 text-accent-foreground" />
              <Kpi title="Low Stock Items" value={String(lowCount)} icon={<AlertTriangle className="h-5 w-5" />} accent="bg-warning/15 text-warning-foreground" />
            </>
          )}
        </div>
      )}

      {!a.isLoading && isAdmin && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi title="Total Expenses" value={formatCurrency(a.totalExpenses)} icon={<Wallet className="h-5 w-5" />} accent="bg-destructive/10 text-destructive" />
          <Kpi title="Net Profit (after expenses)" value={formatCurrency(a.netProfit)} icon={<PiggyBank className="h-5 w-5" />} accent={a.netProfit >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"} />
          <Kpi title="Outstanding Receivables" value={formatCurrency(a.outstanding)} icon={<CreditCard className="h-5 w-5" />} accent="bg-warning/15 text-warning-foreground" />
          <Kpi title="Low Stock Items" value={String(lowCount)} icon={<AlertTriangle className="h-5 w-5" />} accent="bg-warning/15 text-warning-foreground" />
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Purchases vs Sales</CardTitle></CardHeader>
          <CardContent className="h-72">
            {a.trend.length === 0 ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data in this range.</div> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={a.trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="date" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Legend />
                  <Bar dataKey="sales" name="Sales" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="purchases" name="Purchases" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Top Products</CardTitle></CardHeader>
          <CardContent>
            {a.byProduct.length === 0 ? <p className="text-sm text-muted-foreground">No sales yet.</p> : (
              <div className="space-y-3">
                {a.byProduct.map((p) => (
                  <div key={p.name} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2"><Package className="h-4 w-4 text-muted-foreground" />{p.name}</span>
                    <span className="font-medium">{formatCurrency(p.revenue)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {isAdmin && (
        <div className="mt-4 flex justify-end">
          <Button asChild variant="outline"><Link to="/reports">View full reports →</Link></Button>
        </div>
      )}
    </div>
  );
}