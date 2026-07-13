import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { rangeForPreset, type Preset } from "./date-range";

export function useDateRange(initial: Preset = "month") {
  const [preset, setPreset] = useState<Preset>(initial);
  const [custom, setCustom] = useState(rangeForPreset(initial));
  const range = preset === "custom" ? custom : rangeForPreset(preset);
  return { preset, setPreset, custom, setCustom, range };
}

export function useAnalytics(from: string, to: string) {
  const purchases = useQuery({
    queryKey: ["an-purchases", from, to],
    queryFn: async () =>
      (await supabase.from("purchases").select("id,purchase_date,grand_total,supplier_id").gte("purchase_date", from).lte("purchase_date", to)).data ?? [],
  });

  const sales = useQuery({
    queryKey: ["an-sales", from, to],
    queryFn: async () =>
      (await supabase
        .from("sales")
        .select("id,sale_date,grand_total,subtotal,total_cost,restaurant_id,restaurants(name),sale_items(quantity,line_total,cost_price,products(name,categories(name)))")
        .gte("sale_date", from)
        .lte("sale_date", to)).data ?? [],
  });

  const expenses = useQuery({
    queryKey: ["an-expenses", from, to],
    queryFn: async () =>
      (await supabase
        .from("expenses")
        .select("id,expense_date,type,amount")
        .gte("expense_date", from)
        .lte("expense_date", to)).data ?? [],
  });

  const receivables = useQuery({
    queryKey: ["an-receivables", from, to],
    queryFn: async () =>
      (await supabase
        .from("sales")
        .select("grand_total,amount_received")
        .gte("sale_date", from)
        .lte("sale_date", to)).data ?? [],
  });

  const derived = useMemo(() => {
    const s = sales.data ?? [];
    const p = purchases.data ?? [];
    const ex = expenses.data ?? [];
    const rec = receivables.data ?? [];
    const totalSales = s.reduce((a, x) => a + Number(x.grand_total), 0);
    const totalCost = s.reduce((a, x) => a + Number(x.total_cost), 0);
    const totalPurchases = p.reduce((a, x) => a + Number(x.grand_total), 0);
    const profit = totalSales - totalCost;
    const margin = totalSales > 0 ? (profit / totalSales) * 100 : 0;
    const totalExpenses = ex.reduce((a, x) => a + Number(x.amount), 0);
    const salaryExpenses = ex.filter((x: any) => x.type === "salary").reduce((a: number, x: any) => a + Number(x.amount), 0);
    const generalExpenses = totalExpenses - salaryExpenses;
    const grossProfit = profit;
    const netProfit = grossProfit - totalExpenses;
    const outstanding = rec.reduce((a: number, x: any) => a + Math.max(0, Number(x.grand_total) - Number(x.amount_received)), 0);

    const byRestaurant = new Map<string, { name: string; sales: number; cost: number; orders: number }>();
    const byCategory = new Map<string, { revenue: number; cost: number }>();
    const byProduct = new Map<string, { qty: number; revenue: number }>();
    const byDay = new Map<string, { sales: number; purchases: number }>();

    s.forEach((sale: any) => {
      const rn = sale.restaurants?.name ?? "Unknown";
      const r = byRestaurant.get(rn) ?? { name: rn, sales: 0, cost: 0, orders: 0 };
      r.sales += Number(sale.grand_total); r.cost += Number(sale.total_cost); r.orders += 1;
      byRestaurant.set(rn, r);
      const d = byDay.get(sale.sale_date) ?? { sales: 0, purchases: 0 };
      d.sales += Number(sale.grand_total); byDay.set(sale.sale_date, d);
      (sale.sale_items ?? []).forEach((it: any) => {
        const cn = it.products?.categories?.name ?? "Uncategorized";
        const c = byCategory.get(cn) ?? { revenue: 0, cost: 0 };
        c.revenue += Number(it.line_total); c.cost += Number(it.quantity) * Number(it.cost_price);
        byCategory.set(cn, c);
        const pn = it.products?.name ?? "Unknown";
        const pr = byProduct.get(pn) ?? { qty: 0, revenue: 0 };
        pr.qty += Number(it.quantity); pr.revenue += Number(it.line_total);
        byProduct.set(pn, pr);
      });
    });
    p.forEach((pur: any) => {
      const d = byDay.get(pur.purchase_date) ?? { sales: 0, purchases: 0 };
      d.purchases += Number(pur.grand_total); byDay.set(pur.purchase_date, d);
    });

    const trend = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date: date.slice(5), ...v }));

    return {
      totalSales, totalCost, totalPurchases, profit, margin,
      totalExpenses, salaryExpenses, generalExpenses, grossProfit, netProfit, outstanding,
      orders: s.length,
      byRestaurant: [...byRestaurant.values()].map((r) => ({ ...r, profit: r.sales - r.cost })).sort((a, b) => b.sales - a.sales),
      byCategory: [...byCategory.entries()].map(([name, v]) => ({ name, revenue: v.revenue, cost: v.cost, profit: v.revenue - v.cost })).sort((a, b) => b.revenue - a.revenue),
      byProduct: [...byProduct.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue).slice(0, 8),
      trend,
    };
  }, [sales.data, purchases.data, expenses.data, receivables.data]);

  return { ...derived, isLoading: sales.isLoading || purchases.isLoading || expenses.isLoading };
}