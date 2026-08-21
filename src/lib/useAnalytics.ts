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

const query = async (table: string, select: string, dateField?: string, from?: string, to?: string) => {
  let q: any = (supabase.from(table as any) as any).select(select);
  if (dateField && from && to) q = q.gte(dateField, from).lte(dateField, to);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as any[];
};

export function useAnalytics(from: string, to: string) {
  const sales = useQuery({ queryKey: ["report-sales", from, to], queryFn: () => query("sales", "id,sale_date,invoice_no,grand_total,amount_received,total_cost,restaurants(name),sale_items(quantity,line_total,cost_price,products(name,categories(name)))", "sale_date", from, to) });
  const purchases = useQuery({ queryKey: ["report-purchases", from, to], queryFn: () => query("purchases", "id,purchase_date,reference_no,grand_total,amount_paid,suppliers(name)", "purchase_date", from, to) });
  const expenses = useQuery({ queryKey: ["report-expenses", from, to], queryFn: () => query("expenses", "id,expense_date,type,amount,description,expense_categories(name),employees(name),vault_users(name)", "expense_date", from, to) });
  const payments = useQuery({ queryKey: ["report-payments", from, to], queryFn: () => query("payments", "id,payment_date,amount,method,note,restaurants(name),sales(invoice_no),vault_users(name)", "payment_date", from, to) });
  const allSales = useQuery({ queryKey: ["report-current-receivables"], queryFn: () => query("sales", "grand_total,amount_received,restaurants(name)") });
  const allPurchases = useQuery({ queryKey: ["report-current-payables"], queryFn: () => query("purchases", "grand_total,amount_paid,suppliers(name)") });
  const products = useQuery({ queryKey: ["report-current-inventory"], queryFn: () => query("products", "id,name,current_stock,avg_cost,reorder_level,categories(name)") });
  const vaultUsers = useQuery({ queryKey: ["report-vault-users"], queryFn: () => query("vault_users", "id,opening_balance") });
  const topups = useQuery({ queryKey: ["report-vault-topups"], queryFn: () => query("vault_topups", "vault_user_id,amount") });
  const vaultPurchases = useQuery({ queryKey: ["report-vault-purchases"], queryFn: () => query("purchases", "id,vault_user_id,amount_paid") });
  const vaultExpenses = useQuery({ queryKey: ["report-vault-expenses"], queryFn: () => query("expenses", "vault_user_id,amount") });
  const allPayments = useQuery({ queryKey: ["report-vault-receipts"], queryFn: () => query("payments", "vault_user_id,amount") });
  const supplierPayments = useQuery({ queryKey: ["report-vault-supplier-payments"], queryFn: () => query("supplier_payments", "purchase_id,vault_user_id,amount") });
  const periodTopups = useQuery({ queryKey: ["report-period-topups", from, to], queryFn: () => query("vault_topups", "vault_user_id,amount,topup_date,vault_users(name)", "topup_date", from, to) });
  const periodSupplierPayments = useQuery({ queryKey: ["report-period-supplier-payments", from, to], queryFn: () => query("supplier_payments", "purchase_id,vault_user_id,amount,payment_date", "payment_date", from, to) });

  const derived = useMemo(() => {
    const s = sales.data ?? [], p = purchases.data ?? [], ex = expenses.data ?? [], receipts = payments.data ?? [];
    const totalSales = s.reduce((sum, row) => sum + Number(row.grand_total), 0);
    const totalCost = s.reduce((sum, row) => {
      const itemCost = (row.sale_items ?? []).reduce((n: number, item: any) => n + Number(item.cost_price) * Number(item.quantity), 0);
      return sum + ((row.sale_items ?? []).length ? itemCost : Number(row.total_cost));
    }, 0);
    const totalExpenses = ex.reduce((sum, row) => sum + Number(row.amount), 0);
    const grossProfit = totalSales - totalCost;
    const totalPurchases = p.reduce((sum, row) => sum + Number(row.grand_total), 0);
    const margin = totalSales > 0 ? grossProfit / totalSales * 100 : 0;
    const outstanding = (allSales.data ?? []).reduce((sum, row) => sum + Math.max(Number(row.grand_total) - Number(row.amount_received), 0), 0);
    const supplierPayables = (allPurchases.data ?? []).reduce((sum, row) => sum + Math.max(Number(row.grand_total) - Number(row.amount_paid), 0), 0);
    const customerCashReceived = receipts.reduce((sum, row) => sum + Number(row.amount), 0);
    const generalExpenses = ex.filter((row) => row.type !== "salary").reduce((sum, row) => sum + Number(row.amount), 0);
    const salaries = ex.filter((row) => row.type === "salary").reduce((sum, row) => sum + Number(row.amount), 0);

    // Kept deliberately identical to the working Vault page: multi-vault purchase
    // splits use supplier_payments; every other purchase uses purchases.amount_paid.
    const vaultsByPurchase = new Map<string, Set<string>>();
    for (const row of supplierPayments.data ?? []) {
      if (!row.purchase_id || !row.vault_user_id) continue;
      if (!vaultsByPurchase.has(row.purchase_id)) vaultsByPurchase.set(row.purchase_id, new Set());
      vaultsByPurchase.get(row.purchase_id)!.add(row.vault_user_id);
    }
    const splitIds = new Set([...vaultsByPurchase].filter(([, ids]) => ids.size > 1).map(([id]) => id));
    const currentCashOnHand = (vaultUsers.data ?? []).reduce((total, user) => {
      const opening = Number(user.opening_balance);
      const added = (topups.data ?? []).filter((x) => x.vault_user_id === user.id).reduce((n, x) => n + Number(x.amount), 0);
      const received = (allPayments.data ?? []).filter((x) => x.vault_user_id === user.id).reduce((n, x) => n + Number(x.amount), 0);
      const purchaseSpend = (vaultPurchases.data ?? []).filter((x) => x.vault_user_id === user.id && !splitIds.has(x.id)).reduce((n, x) => n + Number(x.amount_paid), 0);
      const splitSpend = (supplierPayments.data ?? []).filter((x) => x.vault_user_id === user.id && x.purchase_id && splitIds.has(x.purchase_id)).reduce((n, x) => n + Number(x.amount), 0);
      const expenseSpend = (vaultExpenses.data ?? []).filter((x) => x.vault_user_id === user.id).reduce((n, x) => n + Number(x.amount), 0);
      return total + opening + added + received - purchaseSpend - splitSpend - expenseSpend;
    }, 0);
    const inventory = (products.data ?? []).map((row) => ({ ...row, inventoryValue: Number(row.current_stock) * Number(row.avg_cost) }));
    const inventoryAtCost = inventory.reduce((sum, row) => sum + row.inventoryValue, 0);
    const netWorkingCapital = currentCashOnHand + outstanding + inventoryAtCost - supplierPayables;
    const restaurantReceivables = [...(allSales.data ?? []).reduce((map: Map<string, any>, row: any) => { const name=row.restaurants?.name ?? "Unknown"; const x=map.get(name) ?? {name,sales:0,received:0,outstanding:0}; x.sales += Number(row.grand_total); x.received += Number(row.amount_received); x.outstanding += Math.max(Number(row.grand_total)-Number(row.amount_received),0); return map.set(name,x); }, new Map()).values()].sort((a:any,b:any)=>b.outstanding-a.outstanding);
    const supplierPayableSummary = [...(allPurchases.data ?? []).reduce((map: Map<string, any>, row: any) => { const name=row.suppliers?.name ?? "Unknown"; const x=map.get(name) ?? {name,purchases:0,paid:0,outstanding:0}; x.purchases += Number(row.grand_total); x.paid += Number(row.amount_paid); x.outstanding += Math.max(Number(row.grand_total)-Number(row.amount_paid),0); return map.set(name,x); }, new Map()).values()].sort((a:any,b:any)=>b.outstanding-a.outstanding);
    const inventoryByCategory = [...inventory.reduce((map: Map<string, number>, row: any) => { const name=row.categories?.name ?? "Uncategorized"; return map.set(name,(map.get(name) ?? 0)+row.inventoryValue); }, new Map()).entries()].map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
    const receiptMethods = [...receipts.reduce((map: Map<string,number>, row:any)=>map.set(row.method ?? "other",(map.get(row.method ?? "other") ?? 0)+Number(row.amount)),new Map()).entries()].map(([name,value])=>({name,value}));
    const expenseCategories = [...ex.reduce((map: Map<string,number>, row:any) => { const name=row.type === "salary" ? "Salaries" : (row.expense_categories?.name ?? "General / Uncategorized"); return map.set(name,(map.get(name) ?? 0)+Number(row.amount)); },new Map()).entries()].map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
    const topupTotal = (periodTopups.data ?? []).reduce((n,row)=>n+Number(row.amount),0);
    const periodPurchaseSpend = p.filter((row:any)=>!splitIds.has(row.id)).reduce((n,row)=>n+Number(row.amount_paid),0) + (periodSupplierPayments.data ?? []).filter((row:any)=>row.purchase_id && splitIds.has(row.purchase_id)).reduce((n,row)=>n+Number(row.amount),0);
    const netCashMovement = customerCashReceived + topupTotal - periodPurchaseSpend - totalExpenses;

    const byRestaurant = new Map<string, { name: string; sales: number; cost: number; orders: number }>();
    const byCategory = new Map<string, { revenue: number; cost: number }>();
    s.forEach((sale) => {
      const name = sale.restaurants?.name ?? "Unknown";
      const row = byRestaurant.get(name) ?? { name, sales: 0, cost: 0, orders: 0 };
      row.sales += Number(sale.grand_total); row.cost += Number(sale.total_cost); row.orders += 1; byRestaurant.set(name, row);
      (sale.sale_items ?? []).forEach((item: any) => { const category = item.products?.categories?.name ?? "Uncategorized"; const c = byCategory.get(category) ?? { revenue: 0, cost: 0 }; c.revenue += Number(item.line_total); c.cost += Number(item.quantity) * Number(item.cost_price); byCategory.set(category, c); });
    });
    const byProduct: { name: string; qty: number; revenue: number }[] = [];
    const productMap = new Map<string, { name: string; qty: number; revenue: number }>();
    s.forEach((sale) => (sale.sale_items ?? []).forEach((item: any) => { const name=item.products?.name ?? "Unknown"; const row=productMap.get(name) ?? {name,qty:0,revenue:0}; row.qty += Number(item.quantity); row.revenue += Number(item.line_total); productMap.set(name,row); }));
    byProduct.push(...[...productMap.values()].sort((a,b)=>b.revenue-a.revenue).slice(0,8));
    const trend: { date: string; sales: number; purchases: number }[] = [];
    const dayMap = new Map<string, { sales: number; purchases: number }>();
    s.forEach((row) => { const day=dayMap.get(row.sale_date) ?? {sales:0,purchases:0}; day.sales += Number(row.grand_total); dayMap.set(row.sale_date,day); });
    p.forEach((row) => { const day=dayMap.get(row.purchase_date) ?? {sales:0,purchases:0}; day.purchases += Number(row.grand_total); dayMap.set(row.purchase_date,day); });
    trend.push(...[...dayMap].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,v])=>({date:date.slice(5),...v})));
    return { totalSales, totalCost, totalPurchases, margin, orders: s.length, trend, byProduct, totalExpenses, generalExpenses, salaries, expenseCategories, grossProfit, netProfit: grossProfit - totalExpenses, outstanding, supplierPayables, customerCashReceived, currentCashOnHand, inventoryAtCost, netWorkingCapital, inventory, inventoryByCategory, restaurantReceivables, supplierPayableSummary, receiptMethods, topupTotal, periodPurchaseSpend, netCashMovement,
      sales: s, purchases: p, expenses: ex, payments: receipts,
      byRestaurant: [...byRestaurant.values()].map((r) => ({ ...r, profit: r.sales - r.cost })).sort((a, b) => b.sales - a.sales),
      byCategory: [...byCategory].map(([name, v]) => ({ name, ...v, profit: v.revenue - v.cost })).sort((a, b) => b.revenue - a.revenue),
    };
  }, [sales.data, purchases.data, expenses.data, payments.data, allSales.data, allPurchases.data, products.data, vaultUsers.data, topups.data, vaultPurchases.data, vaultExpenses.data, allPayments.data, supplierPayments.data, periodTopups.data, periodSupplierPayments.data]);

  const queries = [sales, purchases, expenses, payments, allSales, allPurchases, products, vaultUsers, topups, vaultPurchases, vaultExpenses, allPayments, supplierPayments, periodTopups, periodSupplierPayments];
  return { ...derived, isLoading: queries.some((q) => q.isLoading) };
}
