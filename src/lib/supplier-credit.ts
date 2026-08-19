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
  vaultUserId?: string;
}) {
  const { supplierId, amount, method, date, note, purchaseId, vaultUserId } = opts;
  if (amount <= 0) throw new Error("Amount must be greater than zero");

  const { error } = await (supabase.rpc as any)("save_supplier_payment", {
    p_payment_id: null,
    p_supplier_id: supplierId,
    p_purchase_id: purchaseId ?? null,
    p_amount: amount,
    p_method: method,
    p_payment_date: date,
    p_note: note || null,
    p_vault_user_id: vaultUserId || null,
  });
  if (error) throw error;
}

export async function updateSupplierPayment(
  paymentId: string,
  opts: Parameters<typeof paySupplier>[0],
) {
  const { error } = await (supabase.rpc as any)("save_supplier_payment", {
    p_payment_id: paymentId,
    p_supplier_id: opts.supplierId,
    p_purchase_id: opts.purchaseId ?? null,
    p_amount: opts.amount,
    p_method: opts.method,
    p_payment_date: opts.date,
    p_note: opts.note || null,
    p_vault_user_id: opts.vaultUserId || null,
  });
  if (error) throw error;
}

export async function voidSupplierPayment(paymentId: string) {
  const { error } = await (supabase.rpc as any)("void_supplier_payment", {
    p_payment_id: paymentId,
  });
  if (error) throw error;
}
