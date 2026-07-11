import { formatCurrency, formatDate } from "./format";

export function printInvoice(sale: any) {
  const items = (sale.sale_items ?? [])
    .map(
      (it: any) => `
      <tr>
        <td>${it.products?.name ?? ""}</td>
        <td style="text-align:right">${it.quantity} ${it.products?.unit ?? ""}</td>
        <td style="text-align:right">${formatCurrency(it.unit_price)}</td>
        <td style="text-align:right">${formatCurrency(it.line_total)}</td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
  <title>${sale.invoice_no}</title>
  <style>
    body{font-family:system-ui,Arial,sans-serif;color:#1e293b;padding:32px;max-width:720px;margin:auto}
    h1{margin:0;color:#0f766e}
    .muted{color:#64748b;font-size:13px}
    table{width:100%;border-collapse:collapse;margin-top:24px}
    th,td{padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:14px}
    th{text-align:left;background:#f1f5f9}
    .totals{margin-top:16px;margin-left:auto;width:260px}
    .totals div{display:flex;justify-content:space-between;padding:4px 0;font-size:14px}
    .grand{font-weight:700;font-size:18px;border-top:2px solid #0f766e;padding-top:8px}
    .header{display:flex;justify-content:space-between;align-items:flex-start}
  </style></head><body>
    <div class="header">
      <div><h1>StockFlow</h1><div class="muted">Store Management & Distribution</div></div>
      <div style="text-align:right">
        <div style="font-weight:700;font-size:18px">INVOICE</div>
        <div class="muted">${sale.invoice_no}</div>
        <div class="muted">${formatDate(sale.sale_date)}</div>
      </div>
    </div>
    <div style="margin-top:16px"><span class="muted">Bill To:</span><br/><strong>${sale.restaurants?.name ?? "Walk-in Customer"}</strong></div>
    <table>
      <thead><tr><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Total</th></tr></thead>
      <tbody>${items}</tbody>
    </table>
    <div class="totals">
      <div><span>Subtotal</span><span>${formatCurrency(sale.subtotal)}</span></div>
      <div><span>Discount</span><span>-${formatCurrency(sale.discount)}</span></div>
      <div><span>Tax</span><span>${formatCurrency(sale.tax)}</span></div>
      <div class="grand"><span>Total</span><span>${formatCurrency(sale.grand_total)}</span></div>
    </div>
    <p class="muted" style="margin-top:40px;text-align:center">Thank you for your business.</p>
  </body></html>`;

  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}