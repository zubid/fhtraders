import { supabase } from "@/integrations/supabase/client";

export type PaymentStatus = "paid" | "partial" | "unpaid";

export const PAYMENT_METHODS = ["cash", "bank", "upi", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  bank: "Bank",
  upi: "UPI",
  other: "Other",
};

export type SaleBalance = {
  id: string;
  grand_total: number;
  amount_received: number;
  sale_date: string;
  invoice_no: string;
};

export function saleBalance(s: { grand_total: number; amount_received: number }): number {
  return Math.max(0, Number(s.grand_total) - Number(s.amount_received));
}

/**
 * Distribute a received amount across sales.
 * If preferSaleId is provided, that sale is paid first, remainder flows FIFO (oldest first).
 * Returns the list of sales whose amount_received must be updated.
 */
export function distributePayment(
  sales: SaleBalance[],
  amount: number,
  preferSaleId?: string,
): { id: string; amount_received: number }[] {
  let remaining = amount;
  const updates: { id: string; amount_received: number }[] = [];
  const ordered = [...sales].sort((a, b) => a.sale_date.localeCompare(b.sale_date));
  const queue = preferSaleId
    ? [
        ...ordered.filter((s) => s.id === preferSaleId),
        ...ordered.filter((s) => s.id !== preferSaleId),
      ]
    : ordered;

  for (const s of queue) {
    if (remaining <= 0) break;
    const due = saleBalance(s);
    if (due <= 0) continue;
    const applied = Math.min(due, remaining);
    updates.push({ id: s.id, amount_received: Number(s.amount_received) + applied });
    remaining -= applied;
  }
  // Any leftover (overpayment) is added to the preferred sale, or the newest sale.
  if (remaining > 0.0001) {
    const target =
      (preferSaleId && sales.find((s) => s.id === preferSaleId)) ||
      ordered[ordered.length - 1];
    if (target) {
      const existing = updates.find((u) => u.id === target.id);
      if (existing) existing.amount_received += remaining;
      else updates.push({ id: target.id, amount_received: Number(target.amount_received) + remaining });
    }
  }
  return updates;
}

/** Record a payment: insert ledger row and apply it to sales (FIFO or a specific invoice). */
export async function recordPayment(opts: {
  restaurantId: string;
  amount: number;
  method: string;
  date: string;
  note?: string;
  saleId?: string;
}) {
  const { restaurantId, amount, method, date, note, saleId } = opts;
  if (amount <= 0) throw new Error("Amount must be greater than zero");

  const { data: userData } = await supabase.auth.getUser();

  const { error: pErr } = await supabase.from("payments").insert({
    restaurant_id: restaurantId,
    sale_id: saleId ?? null,
    amount,
    method,
    payment_date: date,
    note: note || null,
    created_by: userData.user?.id ?? null,
  });
  if (pErr) throw pErr;

  const { data: sales, error: sErr } = await supabase
    .from("sales")
    .select("id, grand_total, amount_received, sale_date, invoice_no")
    .eq("restaurant_id", restaurantId)
    .order("sale_date", { ascending: true });
  if (sErr) throw sErr;

  const updates = distributePayment((sales ?? []) as SaleBalance[], amount, saleId);
  for (const u of updates) {
    const { error } = await supabase
      .from("sales")
      .update({ amount_received: u.amount_received })
      .eq("id", u.id);
    if (error) throw error;
  }
}
