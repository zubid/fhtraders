import { supabase } from "@/integrations/supabase/client";
import { PAYMENT_METHODS, METHOD_LABELS } from "@/lib/credit";

export { PAYMENT_METHODS, METHOD_LABELS };

export type PurchaseBalance = {
  id: string;
  grand_total: number;
  amount_paid: number;
  purchase_date: string;
  reference_no: string;
};

export function purchaseBalance(p: { grand_total: number; amount_paid: number }): number {
  return Math.max(0, Number(p.grand_total) - Number(p.amount_paid));
}

export function distributeSupplierPayment(
  purchases: PurchaseBalance[],
  amount: number,
  preferPurchaseId?: string,
): { id: string; amount_paid: number }[] {
  let remaining = amount;
  const updates: { id: string; amount_paid: number }[] = [];
  const ordered = [...purchases].sort((a, b) => a.purchase_date.localeCompare(b.purchase_date));
  const queue = preferPurchaseId
    ? [
        ...ordered.filter((p) => p.id === preferPurchaseId),
        ...ordered.filter((p) => p.id !== preferPurchaseId),
      ]
    : ordered;

  for (const p of queue) {
    if (remaining <= 0) break;
    const due = purchaseBalance(p);
    if (due <= 0) continue;
    const applied = Math.min(due, remaining);
    updates.push({ id: p.id, amount_paid: Number(p.amount_paid) + applied });
    remaining -= applied;
  }
  if (remaining > 0.0001) {
    const target =
      (preferPurchaseId && purchases.find((p) => p.id === preferPurchaseId)) ||
      ordered[ordered.length - 1];
    if (target) {
      const existing = updates.find((u) => u.id === target.id);
      if (existing) existing.amount_paid += remaining;
      else updates.push({ id: target.id, amount_paid: Number(target.amount_paid) + remaining });
    }
  }
  return updates;
}

export async function paySupplier(opts: {
  supplierId: string;
  amount: number;
  method: string;
  date: string;
  note?: string;
  purchaseId?: string;
}) {
  const { supplierId, amount, method, date, note, purchaseId } = opts;
  if (amount <= 0) throw new Error("Amount must be greater than zero");

  const { data: userData } = await supabase.auth.getUser();

  const { error: pErr } = await (supabase.from("supplier_payments" as any) as any).insert({
    supplier_id: supplierId,
    purchase_id: purchaseId ?? null,
    amount,
    method,
    payment_date: date,
    note: note || null,
    created_by: userData.user?.id ?? null,
  });
  if (pErr) throw pErr;

  const { data: purchases, error: sErr } = await supabase
    .from("purchases")
    .select("id, grand_total, amount_paid, purchase_date, reference_no")
    .eq("supplier_id", supplierId)
    .order("purchase_date", { ascending: true });
  if (sErr) throw sErr;

  const updates = distributeSupplierPayment((purchases ?? []) as any as PurchaseBalance[], amount, purchaseId);
  for (const u of updates) {
    const { error } = await supabase
      .from("purchases")
      .update({ amount_paid: u.amount_paid } as any)
      .eq("id", u.id);
    if (error) throw error;
  }
}