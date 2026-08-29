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

  const { data, error } = await supabase.rpc("record_supplier_payment", {
    p_supplier_id: supplierId,
    p_amount: amount,
    p_method: method,
    p_payment_date: date,
    p_note: note || null,
    p_preferred_purchase_id: purchaseId ?? null,
    p_vault_user_id: vaultUserId || null,
  });
  if (error) throw error;
  return data;
}
