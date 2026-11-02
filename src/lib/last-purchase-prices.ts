import { supabase } from "@/integrations/supabase/client";

/** Most recent recorded purchase unit price per product, based on purchase date and entry time.
 * Display-only reference: never substitute this for inventory average cost or sale COGS.
 */
export async function getLastPurchasePrices(): Promise<Record<string, number>> {
  const latest: Record<string, { price: number; date: string; created: string; itemCreated: string }> = {};
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("purchase_items")
      .select("product_id,unit_price,created_at,purchases!inner(purchase_date,created_at)")
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      const purchase = row.purchases as { purchase_date: string; created_at: string } | null;
      if (!purchase) continue;
      const current = latest[row.product_id];
      const date = purchase.purchase_date ?? "";
      const created = purchase.created_at ?? "";
      const itemCreated = row.created_at ?? "";
      if (!current || date > current.date ||
        (date === current.date && (created > current.created ||
          (created === current.created && itemCreated > current.itemCreated)))) {
        latest[row.product_id] = { price: Number(row.unit_price), date, created, itemCreated };
      }
    }
    if ((data ?? []).length < pageSize) break;
  }
  return Object.fromEntries(Object.entries(latest).map(([id, entry]) => [id, entry.price]));
}
