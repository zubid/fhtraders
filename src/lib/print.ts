import { formatCurrency, formatDate } from "./format";
import { getBranding } from "./settings";

function esc(s: any): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string),
  );
}

function baseStyles(): string {
  return `
    *{box-sizing:border-box}
    body{font-family:'Segoe UI',system-ui,Arial,sans-serif;color:#1e293b;padding:36px;max-width:820px;margin:auto;font-size:13px}
    .brand{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0f766e;padding-bottom:16px}
    .brand-left{display:flex;gap:14px;align-items:center}
    .brand-left img{height:56px;width:auto;object-fit:contain;border-radius:8px}
    .biz-name{font-size:22px;font-weight:800;color:#0f766e;margin:0;line-height:1.1}
    .biz-tag{color:#64748b;font-size:12px;margin-top:2px}
    .biz-contact{color:#64748b;font-size:11px;margin-top:4px;line-height:1.5}
    .doc-title{text-align:right}
    .doc-title .t{font-weight:800;font-size:20px;letter-spacing:1px;color:#0f172a}
    .doc-title .m{color:#64748b;font-size:12px;margin-top:2px}
    .meta{margin-top:18px;display:flex;justify-content:space-between;gap:24px}
    .meta .box{font-size:12px}
    .meta .label{color:#94a3b8;text-transform:uppercase;font-size:10px;letter-spacing:.5px}
    table{width:100%;border-collapse:collapse;margin-top:22px}
    th,td{padding:9px 10px;font-size:12.5px}
    thead th{text-align:left;background:#0f766e;color:#fff;font-weight:600}
    tbody td{border-bottom:1px solid #e2e8f0}
    tbody tr:nth-child(even){background:#f8fafc}
    .r{text-align:right}
    .totals{margin-top:18px;margin-left:auto;width:300px}
    .totals div{display:flex;justify-content:space-between;padding:5px 0;font-size:13px}
    .totals .grand{font-weight:800;font-size:17px;border-top:2px solid #0f766e;padding-top:8px;color:#0f172a}
    .pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700}
    .footer{margin-top:44px;text-align:center;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:14px}
    @media print{body{padding:12px}}
  `;
}

function brandHeader(docTitle: string, docRef?: string, docDate?: string): string {
  const b = getBranding();
  const logo = b.logo_url ? `<img src="${esc(b.logo_url)}" alt="logo"/>` : "";
  const contactBits = [b.address, b.phone, b.email].filter(Boolean).map(esc).join(" · ");
  const person = b.contact_person ? `<div class="biz-contact"><strong>Contact:</strong> ${esc(b.contact_person)}</div>` : "";
  return `
    <div class="brand">
      <div class="brand-left">
        ${logo}
        <div>
          <p class="biz-name">${esc(b.business_name)}</p>
          <div class="biz-tag">${esc(b.business_tagline)}</div>
          ${contactBits ? `<div class="biz-contact">${contactBits}</div>` : ""}
          ${person}
        </div>
      </div>
      <div class="doc-title">
        <div class="t">${esc(docTitle)}</div>
        ${docRef ? `<div class="m">${esc(docRef)}</div>` : ""}
        ${docDate ? `<div class="m">${esc(docDate)}</div>` : ""}
      </div>
    </div>`;
}

function render(title: string, inner: string) {
  const b = getBranding();
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(title)}</title>
    <style>${baseStyles()}</style></head><body>
    ${inner}
    <div class="footer">${esc(b.invoice_footer)}</div>
    </body></html>`;
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
}

export function printInvoice(sale: any) {
  const b = getBranding();
  const items = (sale.sale_items ?? [])
    .map(
      (it: any) => `<tr>
        <td>${esc(it.products?.name ?? "")}</td>
        <td class="r">${it.quantity} ${esc(it.products?.unit ?? "")}</td>
        <td class="r">${formatCurrency(it.unit_price)}</td>
        <td class="r">${formatCurrency(it.line_total)}</td>
      </tr>`,
    )
    .join("");
  const balance = Math.max(0, Number(sale.grand_total ?? 0) - Number(sale.amount_received ?? 0));
  const status = (sale.payment_status ?? "unpaid").toUpperCase();
  const statusColor = status === "PAID" ? "#16a34a" : status === "PARTIAL" ? "#d97706" : "#dc2626";
  const inner = `
    ${brandHeader("INVOICE", sale.invoice_no, formatDate(sale.sale_date))}
    <div class="meta">
      <div class="box"><div class="label">Bill To</div><strong>${esc(sale.restaurants?.name ?? "Walk-in Customer")}</strong></div>
      <div class="box r"><div class="label">Status</div><span class="pill" style="background:${statusColor}22;color:${statusColor}">${status}</span></div>
    </div>
    <table><thead><tr><th>Product</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th></tr></thead>
    <tbody>${items}</tbody></table>
    <div class="totals">
      <div><span>Subtotal</span><span>${formatCurrency(sale.subtotal)}</span></div>
      <div><span>Discount</span><span>-${formatCurrency(sale.discount)}</span></div>
      <div><span>Tax</span><span>${formatCurrency(sale.tax)}</span></div>
      <div class="grand"><span>Total</span><span>${formatCurrency(sale.grand_total)}</span></div>
      <div><span>Amount Received</span><span>${formatCurrency(sale.amount_received)}</span></div>
      <div style="font-weight:700"><span>Balance Due</span><span>${formatCurrency(balance)}</span></div>
    </div>`;
  render(sale.invoice_no ?? "Invoice", inner);
}

export function printPurchase(purchase: any) {
  const items = (purchase.purchase_items ?? [])
    .map(
      (it: any) => `<tr>
        <td>${esc(it.products?.name ?? "")}</td>
        <td class="r">${it.quantity} ${esc(it.products?.unit ?? "")}</td>
        <td class="r">${formatCurrency(it.unit_price)}</td>
        <td class="r">${formatCurrency(it.line_total)}</td>
      </tr>`,
    )
    .join("");
  const inner = `
    ${brandHeader("PURCHASE", purchase.reference_no, formatDate(purchase.purchase_date))}
    <div class="meta">
      <div class="box"><div class="label">Supplier</div><strong>${esc(purchase.suppliers?.name ?? "—")}</strong></div>
    </div>
    <table><thead><tr><th>Product</th><th class="r">Qty</th><th class="r">Unit Price</th><th class="r">Total</th></tr></thead>
    <tbody>${items}</tbody></table>
    <div class="totals">
      <div class="grand"><span>Grand Total</span><span>${formatCurrency(purchase.grand_total)}</span></div>
    </div>`;
  render(purchase.reference_no ?? "Purchase", inner);
}

export function printStatement(opts: {
  restaurant: any;
  sales: any[];
  payments: any[];
}) {
  const { restaurant, sales, payments } = opts;
  const events = [
    ...(sales ?? []).map((s) => ({ date: s.sale_date, type: "Invoice", ref: s.invoice_no, debit: Number(s.grand_total), credit: 0 })),
    ...(payments ?? []).map((p: any) => ({ date: p.payment_date, type: "Payment", ref: p.sales?.invoice_no ?? "On account", debit: 0, credit: Number(p.amount) })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  let bal = 0;
  const rows = events
    .map((e) => {
      bal += e.debit - e.credit;
      return `<tr>
        <td>${formatDate(e.date)}</td>
        <td>${esc(e.type)}</td>
        <td>${esc(e.ref)}</td>
        <td class="r">${e.debit ? formatCurrency(e.debit) : "—"}</td>
        <td class="r">${e.credit ? formatCurrency(e.credit) : "—"}</td>
        <td class="r">${formatCurrency(bal)}</td>
      </tr>`;
    })
    .join("");
  const totalSales = (sales ?? []).reduce((s, x) => s + Number(x.grand_total), 0);
  const totalPaid = (sales ?? []).reduce((s, x) => s + Number(x.amount_received), 0);
  const outstanding = Math.max(0, totalSales - totalPaid);
  const inner = `
    ${brandHeader("STATEMENT OF ACCOUNT", undefined, formatDate(new Date()))}
    <div class="meta">
      <div class="box"><div class="label">Account</div><strong>${esc(restaurant?.name ?? "")}</strong>
        ${restaurant?.phone ? `<div style="color:#64748b">${esc(restaurant.phone)}</div>` : ""}
        ${restaurant?.address ? `<div style="color:#64748b">${esc(restaurant.address)}</div>` : ""}
      </div>
      <div class="box r"><div class="label">Outstanding Balance</div><strong style="font-size:18px;color:${outstanding > 0 ? "#dc2626" : "#16a34a"}">${formatCurrency(outstanding)}</strong></div>
    </div>
    <table><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6" style="text-align:center;color:#94a3b8">No transactions.</td></tr>`}</tbody></table>
    <div class="totals">
      <div><span>Total Invoiced</span><span>${formatCurrency(totalSales)}</span></div>
      <div><span>Total Received</span><span>${formatCurrency(totalPaid)}</span></div>
      <div class="grand"><span>Balance Due</span><span>${formatCurrency(outstanding)}</span></div>
    </div>`;
  render(`Statement - ${restaurant?.name ?? "account"}`, inner);
}

export function printReport(opts: {
  title: string;
  subtitle?: string;
  columns: { key: string; label: string; align?: "left" | "right" }[];
  rows: Record<string, any>[];
  summary?: { label: string; value: string }[];
}) {
  const { title, subtitle, columns, rows, summary } = opts;
  const thead = columns
    .map((c) => `<th class="${c.align === "right" ? "r" : ""}">${esc(c.label)}</th>`)
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${columns
          .map((c) => `<td class="${c.align === "right" ? "r" : ""}">${esc(row[c.key])}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  const summaryHtml = summary
    ? `<div class="totals">${summary
        .map(
          (s, i) =>
            `<div class="${i === summary.length - 1 ? "grand" : ""}"><span>${esc(s.label)}</span><span>${esc(s.value)}</span></div>`,
        )
        .join("")}</div>`
    : "";
  const inner = `
    ${brandHeader(title.toUpperCase(), subtitle, formatDate(new Date()))}
    <table><thead><tr>${thead}</tr></thead>
    <tbody>${body || `<tr><td colspan="${columns.length}" style="text-align:center;color:#94a3b8">No data.</td></tr>`}</tbody></table>
    ${summaryHtml}`;
  render(title, inner);
}
