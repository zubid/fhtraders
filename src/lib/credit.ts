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

/**
 * Rebuild amount_received for every sale of a restaurant from scratch, by replaying
 * every remaining row in the payments ledger (oldest first) through distributePayment.
 *
 * This is the single source of truth for sale balances. It must be called after ANY
 * change to the payments table for a restaurant (insert, edit, or delete) so that
 * amount_received / payment_status can never drift out of sync with the ledger —
 * including when a payment is deleted after it had already been split across
 * multiple invoices via FIFO.
 */
export async function recomputeRestaurantBalances(restaurantId: string) {
  const { data: sales, error: sErr } = await supabase
    .from("sales")
    .select("id, grand_total, amount_received, sale_date, invoice_no")
    .eq("restaurant_id", restaurantId)
    .order("sale_date", { ascending: true });
  if (sErr) throw sErr;

  const { data: payments, error: pErr } = await supabase
    .from("payments")
    .select("id, amount, sale_id, payment_date, created_at")
    .eq("restaurant_id", restaurantId)
    .order("payment_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (pErr) throw pErr;

  // Start every sale at zero received, then replay the ledger in chronological order.
  const state = new Map<string, SaleBalance>(
    (sales ?? []).map((s: any) => [s.id, { ...s, amount_received: 0 }]),
  );

  for (const p of payments ?? []) {
    const current = Array.from(state.values());
    const updates = distributePayment(current, Number(p.amount), p.sale_id ?? undefined);
    for (const u of updates) {
      const existing = state.get(u.id);
      if (existing) existing.amount_received = u.amount_received;
    }
  }

  // Only write rows whose value actually changed, but it's cheap/safe to just write all.
  const original = new Map((sales ?? []).map((s: any) => [s.id, Number(s.amount_received)]));
  const toWrite = Array.from(state.values()).filter(
    (s) => Math.abs(Number(s.amount_received) - (original.get(s.id) ?? 0)) > 0.0001,
  );

  for (const s of toWrite) {
    const { error } = await supabase
      .from("sales")
      .update({ amount_received: s.amount_received })
      .eq("id", s.id);
    if (error) throw error;
  }
}

/** Record a payment: insert ledger row, then recompute balances for the restaurant. */
export async function recordPayment(opts: {
  restaurantId: string;
  amount: number;
  method: string;
  date: string;
  note?: string;
  saleId?: string;
  vaultUserId?: string;
}) {
  const { restaurantId, amount, method, date, note, saleId, vaultUserId } = opts;
  if (amount <= 0) throw new Error("Amount must be greater than zero");

  const { data: userData } = await supabase.auth.getUser();

  const { error: pErr } = await (supabase.from("payments") as any).insert({
    restaurant_id: restaurantId,
    sale_id: saleId ?? null,
    amount,
    method,
    payment_date: date,
    note: note || null,
    created_by: userData.user?.id ?? null,
    vault_user_id: vaultUserId || null,
  });
  if (pErr) throw pErr;

  await recomputeRestaurantBalances(restaurantId);
}

/** Delete a payment from the ledger, then recompute balances for the restaurant. */
export async function deletePayment(paymentId: string, restaurantId: string) {
  const { error } = await supabase.from("payments").delete().eq("id", paymentId);
  if (error) throw error;
  await recomputeRestaurantBalances(restaurantId);
}

/** Edit an existing payment (amount / date / method / note / target invoice), then recompute. */
export async function updatePayment(
  paymentId: string,
  restaurantId: string,
  fields: { amount?: number; method?: string; date?: string; note?: string; saleId?: string | null },
) {
  if (fields.amount !== undefined && fields.amount <= 0) {
    throw new Error("Amount must be greater than zero");
  }
  const { error } = await supabase
    .from("payments")
    .update({
      ...(fields.amount !== undefined ? { amount: fields.amount } : {}),
      ...(fields.method !== undefined ? { method: fields.method } : {}),
      ...(fields.date !== undefined ? { payment_date: fields.date } : {}),
      ...(fields.note !== undefined ? { note: fields.note || null } : {}),
      ...(fields.saleId !== undefined ? { sale_id: fields.saleId } : {}),
    })
    .eq("id", paymentId);
  if (error) throw error;
  await recomputeRestaurantBalances(restaurantId);
}
