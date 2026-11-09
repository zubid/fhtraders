export type SupplierLedgerEvent = {
  id: string;
  date: string;
  type: "Purchase" | "Payment" | "Historical payment";
  reference: string;
  debit: number;
  credit: number;
  balance: number;
  note: string;
};

const money = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100;
const dateOnly = (value: unknown) => String(value ?? "").slice(0, 10);

export function buildSupplierLedger(purchases: any[], payments: any[]) {
  const paymentTotals = new Map<string, number>();
  for (const payment of payments) {
    if (payment.purchase_id) {
      paymentTotals.set(payment.purchase_id, money((paymentTotals.get(payment.purchase_id) ?? 0) + money(payment.amount)));
    }
  }
  const events: Omit<SupplierLedgerEvent, "balance">[] = [];
  for (const purchase of purchases) {
    const date = dateOnly(purchase.purchase_date);
    events.push({
      id: "purchase-" + purchase.id, date, type: "Purchase",
      reference: purchase.reference_no ?? purchase.id,
      debit: money(purchase.grand_total), credit: 0, note: "",
    });
    // Legacy payments may be reflected in purchases.amount_paid without a matching
    // supplier_payments row. Disclose this separately; never silently omit it.
    const historical = money(money(purchase.amount_paid) - (paymentTotals.get(purchase.id) ?? 0));
    if (historical > 0.009) {
      events.push({
        id: "historical-" + purchase.id, date, type: "Historical payment",
        reference: purchase.reference_no ?? purchase.id,
        debit: 0, credit: historical,
        note: "Historical amount paid without a dated payment record; displayed at purchase date for reconciliation",
      });
    }
  }
  for (const payment of payments) {
    events.push({
      id: "payment-" + payment.id,
      date: dateOnly(payment.payment_date),
      type: "Payment",
      reference: payment.purchases?.reference_no ?? "General payment",
      debit: 0, credit: money(payment.amount),
      note: [payment.method, payment.note].filter(Boolean).join(" · "),
    });
  }
  const priority = { Purchase: 0, "Historical payment": 1, Payment: 2 };
  events.sort((a, b) => a.date.localeCompare(b.date) || priority[a.type] - priority[b.type] || a.id.localeCompare(b.id));
  let balance = 0;
  const rows: SupplierLedgerEvent[] = events.map(event => {
    balance = money(balance + event.debit - event.credit);
    return { ...event, balance };
  });
  const totalPurchases = money(purchases.reduce((s, p) => s + money(p.grand_total), 0));
  const totalPayments = money(payments.reduce((s, p) => s + money(p.amount), 0));
  const historicalPayments = money(purchases.reduce((s, p) =>
    s + Math.max(0, money(money(p.amount_paid) - (paymentTotals.get(p.id) ?? 0))), 0));
  const expectedBalance = money(purchases.reduce((s, p) => s + money(p.grand_total) - money(p.amount_paid), 0));
  const discrepancy = money(balance - expectedBalance);
  return { rows, totalPurchases, totalPayments: money(totalPayments + historicalPayments), historicalPayments, balance, expectedBalance, discrepancy };
}

export function supplierStatementPeriod(rows: SupplierLedgerEvent[], from: string, to: string) {
  const opening = rows.filter(r => from && r.date < from).reduce((s, r) => money(s + r.debit - r.credit), 0);
  const selected = rows.filter(r => (!from || r.date >= from) && (!to || r.date <= to));
  return {
    opening,
    rows: selected,
    purchases: money(selected.reduce((s, r) => s + r.debit, 0)),
    payments: money(selected.reduce((s, r) => s + r.credit, 0)),
    closing: money(opening + selected.reduce((s, r) => s + r.debit - r.credit, 0)),
  };
}
