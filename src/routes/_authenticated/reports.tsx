import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Download, Printer } from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { PageHeader } from "@/components/app/PageHeader";
import { RangePicker } from "@/components/app/RangePicker";
import { useAuth } from "@/hooks/useAuth";
import { useAnalytics, useDateRange } from "@/lib/useAnalytics";
import { formatCurrency, formatNumber, downloadCSV } from "@/lib/format";
import { printReport } from "@/lib/print";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function ReportsPage() {
  const { isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const { preset, setPreset, custom, setCustom, range } = useDateRange("month");
  const a = useAnalytics(range.from, range.to);

  useEffect(() => {
    if (!loading && !isAdmin) navigate({ to: "/dashboard", replace: true });
  }, [loading, isAdmin, navigate]);

  if (!isAdmin) return null;

  const exportRestaurants = () => {
    const rows: (string | number)[][] = [["Restaurant", "Orders", "Sales", "Profit"]];
    a.byRestaurant.forEach((r) => rows.push([r.name, r.orders, r.sales.toFixed(2), r.profit.toFixed(2)]));
    downloadCSV("sales-by-restaurant.csv", rows);
  };
  const exportCategories = () => {
    const rows: (string | number)[][] = [["Category", "Revenue", "Cost", "Profit"]];
    a.byCategory.forEach((c) => rows.push([c.name, c.revenue.toFixed(2), c.cost.toFixed(2), c.profit.toFixed(2)]));
    downloadCSV("sales-by-category.csv", rows);
  };

  const printRestaurants = () =>
    printReport({
      title: "Sales by Restaurant",
      subtitle: `${range.from} to ${range.to}`,
      columns: [
        { key: "name", label: "Restaurant" },
        { key: "orders", label: "Orders", align: "right" },
        { key: "sales", label: "Sales", align: "right" },
        { key: "profit", label: "Profit", align: "right" },
      ],
      rows: a.byRestaurant.map((r) => ({ name: r.name, orders: r.orders, sales: formatCurrency(r.sales), profit: formatCurrency(r.profit) })),
      summary: [
        { label: "Total Revenue", value: formatCurrency(a.totalSales) },
        { label: "Total Profit", value: formatCurrency(a.profit) },
      ],
    });

  return (
    <div>
      <PageHeader
        title="Profit & Sales Reports"
        description="Financial analytics across the selected date range"
        actions={<Button variant="outline" onClick={printRestaurants}><Printer className="mr-1 h-4 w-4" />Print Report</Button>}
      />
      <div className="mb-6"><RangePicker preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} /></div>

      {a.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Revenue</p><p className="mt-1 text-2xl font-bold">{formatCurrency(a.totalSales)}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Cost of Goods</p><p className="mt-1 text-2xl font-bold">{formatCurrency(a.totalCost)}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Profit</p><p className="mt-1 text-2xl font-bold text-success">{formatCurrency(a.profit)}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Margin</p><p className="mt-1 text-2xl font-bold">{formatNumber(a.margin, 1)}%</p></CardContent></Card>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Revenue by Category</CardTitle>
            <Button variant="ghost" size="sm" onClick={exportCategories}><Download className="mr-1 h-4 w-4" />CSV</Button>
          </CardHeader>
          <CardContent className="h-72">
            {a.byCategory.length === 0 ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data.</div> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={a.byCategory} dataKey="revenue" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e: any) => e.name}>
                    {a.byCategory.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Profit by Category</CardTitle></CardHeader>
          <CardContent className="h-72">
            {a.byCategory.length === 0 ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data.</div> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={a.byCategory}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="profit" name="Profit" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Sales by Restaurant</CardTitle>
          <Button variant="ghost" size="sm" onClick={exportRestaurants}><Download className="mr-1 h-4 w-4" />CSV</Button>
        </CardHeader>
        <CardContent>
          {a.byRestaurant.length === 0 ? <p className="text-sm text-muted-foreground">No sales in this range.</p> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Restaurant</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Sales</TableHead><TableHead className="text-right">Profit</TableHead><TableHead className="text-right">Margin</TableHead></TableRow></TableHeader>
                <TableBody>
                  {a.byRestaurant.map((r) => (
                    <TableRow key={r.name}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-right">{r.orders}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.sales)}</TableCell>
                      <TableCell className="text-right text-success">{formatCurrency(r.profit)}</TableCell>
                      <TableCell className="text-right">{r.sales > 0 ? formatNumber((r.profit / r.sales) * 100, 1) : "0"}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}