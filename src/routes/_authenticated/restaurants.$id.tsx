import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Phone, Mail, MapPin, CreditCard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/restaurants/$id")({
  component: RestaurantProfile,
});

function RestaurantProfile() {
  const { id } = Route.useParams();

  const { data: restaurant, isLoading } = useQuery({
    queryKey: ["restaurant", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("restaurants").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: sales } = useQuery({
    queryKey: ["restaurant-sales", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("*, sale_items(quantity, line_total, products(name, categories(name)))")
        .eq("restaurant_id", id)
        .order("sale_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const lifetime = (sales ?? []).reduce((s, x) => s + Number(x.grand_total), 0);
  const orders = sales?.length ?? 0;

  const byCategory = new Map<string, number>();
  (sales ?? []).forEach((sale) =>
    (sale.sale_items ?? []).forEach((it: any) => {
      const cat = it.products?.categories?.name ?? "Uncategorized";
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + Number(it.line_total));
    }),
  );

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!restaurant) return <div className="py-12 text-center text-muted-foreground">Restaurant not found.</div>;

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/restaurants"><ArrowLeft className="mr-1 h-4 w-4" />Back</Link></Button>
      <PageHeader
        title={restaurant.name}
        description={restaurant.is_active ? "Active account" : "Inactive account"}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {restaurant.contact_person && <div className="flex items-center gap-2"><Badge variant="secondary">Contact</Badge>{restaurant.contact_person}</div>}
            {restaurant.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-4 w-4" />{restaurant.phone}</div>}
            {restaurant.email && <div className="flex items-center gap-2 text-muted-foreground"><Mail className="h-4 w-4" />{restaurant.email}</div>}
            {restaurant.address && <div className="flex items-center gap-2 text-muted-foreground"><MapPin className="h-4 w-4" />{restaurant.address}</div>}
            {restaurant.credit_terms && <div className="flex items-center gap-2 text-muted-foreground"><CreditCard className="h-4 w-4" />{restaurant.credit_terms}</div>}
          </CardContent>
        </Card>
        <div className="grid gap-4 lg:col-span-2 sm:grid-cols-2">
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Lifetime Purchases</p><p className="mt-1 text-2xl font-bold">{formatCurrency(lifetime)}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Orders</p><p className="mt-1 text-2xl font-bold">{orders}</p></CardContent></Card>
          <Card className="sm:col-span-2">
            <CardHeader><CardTitle className="text-base">Category Breakdown</CardTitle></CardHeader>
            <CardContent>
              {byCategory.size === 0 ? <p className="text-sm text-muted-foreground">No purchases yet.</p> : (
                <div className="space-y-2">
                  {[...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([cat, val]) => (
                    <div key={cat} className="flex items-center justify-between text-sm">
                      <span>{cat}</span><span className="font-medium">{formatCurrency(val)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle className="text-base">Order History</CardTitle></CardHeader>
        <CardContent>
          {(sales ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No orders yet.</p> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Items</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(sales ?? []).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.invoice_no}</TableCell>
                      <TableCell>{formatDate(s.sale_date)}</TableCell>
                      <TableCell>{s.sale_items?.length ?? 0}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(s.grand_total)}</TableCell>
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