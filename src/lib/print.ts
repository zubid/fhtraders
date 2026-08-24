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

/** Modern, print-ready customer product catalog. */
export function printCatalog(
  groups: { name: string; color?: string; items: any[] }[],
  opts?: { showPrices?: boolean; note?: string },
) {
  const b = getBranding();
  const showPrices = opts?.showPrices !== false;
  const logo = b.logo_url ? `<img src="${esc(b.logo_url)}" alt="${esc(b.business_name)} logo"/>` : "";
  const contactBits = [b.address, b.phone, b.email].filter(Boolean).map(esc).join(" · ");
  const populatedGroups = groups.filter((group) => group.items.length > 0);
  const productCount = populatedGroups.reduce((total, group) => total + group.items.length, 0);
  const catalogLabel = showPrices ? "Priced Catalog" : "Product Catalog";
  const pricingNote = showPrices
    ? "Prices are reference selling prices and may vary based on quantity, market conditions and order requirements. Contact FH Traders for current bulk quotations."
    : "Contact FH Traders for current pricing and bulk quotations.";

  const sections = populatedGroups.map((group) => `
    <section class="category">
      <div class="category-heading" style="border-left-color:${esc(group.color ?? "#0f766e")}">
        <h2>${esc(group.name)}</h2>
      </div>
      <table>
        <thead><tr><th>Product</th><th class="unit-col">Unit</th>${showPrices ? `<th class="price-col">Price</th>` : ""}</tr></thead>
        <tbody>${group.items.map((product: any) => `
          <tr>
            <td class="product-name">${esc(product.name)}</td>
            <td class="unit-col">${esc(product.unit)}</td>
            ${showPrices ? `<td class="price-col">${Number(product.price) > 0 ? formatCurrency(product.price) : `<span class="request">On request</span>`}</td>` : ""}
          </tr>`).join("")}
        </tbody>
      </table>
    </section>`).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(b.business_name)} — ${catalogLabel}</title>
  <style>
    *{box-sizing:border-box}
    @page{size:A4;margin:14mm 14mm 16mm}
    body{font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif;color:#172033;margin:0;background:#fff;font-size:12px;line-height:1.45}
    .catalog-header{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:start;padding-bottom:15px;border-bottom:3px solid #0f766e}
    .identity{display:flex;align-items:center;gap:14px;min-width:0}
    .identity img{width:64px;height:64px;object-fit:contain;border-radius:8px}
    .business-name{margin:0;color:#0f766e;font-size:24px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;line-height:1.1}
    .tagline{margin-top:4px;color:#536171;font-size:12px;font-weight:500}
    .document{text-align:right;white-space:nowrap}
    .document h1{margin:0;font-size:19px;letter-spacing:1.6px;text-transform:uppercase;color:#172033}
    .document-type{margin-top:3px;color:#0f766e;font-weight:700}
    .generated{margin-top:3px;color:#697586;font-size:11px}
    .contact{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:12px;padding:9px 12px;background:#f1f7f6;border-left:3px solid #0f766e;color:#465466;font-size:11px}
    .contact-person{font-weight:650;color:#243244}
    .summary{display:flex;gap:18px;margin:16px 0 4px;color:#697586;font-size:11px}
    .summary strong{color:#172033;font-size:13px}
    .category{margin-top:20px;break-inside:auto;page-break-inside:auto}
    .category-heading{border-left:4px solid #0f766e;border-bottom:1px solid #b9d4d0;padding:4px 0 5px 9px;margin-bottom:6px;break-after:avoid;page-break-after:avoid}
    .category-heading h2{margin:0;font-size:13px;line-height:1.25;letter-spacing:1px;text-transform:uppercase;color:#173b38}
    table{width:100%;border-collapse:collapse;table-layout:fixed}
    thead{display:table-header-group}
    th{padding:6px 9px;background:#eaf3f2;color:#334b49;text-align:left;text-transform:uppercase;letter-spacing:.65px;font-size:9.5px;font-weight:750;border-bottom:1px solid #b9d4d0}
    td{padding:7px 9px;border-bottom:1px solid #e4e9ee;vertical-align:middle}
    tbody tr{break-inside:avoid;page-break-inside:avoid}
    tbody tr:nth-child(even){background:#f8fafb}
    .product-name{font-weight:600;color:#172033}
    .unit-col{width:${showPrices ? "20%" : "30%"};color:#647181}
    .price-col{width:28%;text-align:right;font-weight:750;color:#0b625b;white-space:nowrap}
    .request{color:#6b7280;font-style:italic;font-weight:500}
    .catalog-note{margin-top:22px;padding:10px 12px;border:1px solid #cddbd9;background:#f8fbfa;color:#4a5968;font-size:10.5px;break-inside:avoid}
    .footer{margin-top:18px;padding-top:9px;border-top:1px solid #d9e1e7;text-align:center;color:#718096;font-size:10px;break-inside:avoid}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.category{margin-top:16px}}
  </style></head><body>
    <header class="catalog-header">
      <div class="identity">${logo}<div><h1 class="business-name">${esc(b.business_name)}</h1><div class="tagline">${esc(b.business_tagline)}</div></div></div>
      <div class="document"><h1>Product Catalog</h1><div class="document-type">${catalogLabel}</div><div class="generated">Generated: ${esc(formatDate(new Date()))}</div></div>
    </header>
    <div class="contact">${contactBits ? `<span>${contactBits}</span>` : ""}${b.contact_person ? `<span class="contact-person">Contact: ${esc(b.contact_person)}</span>` : ""}</div>
    <div class="summary"><span><strong>${productCount}</strong> Products</span><span><strong>${populatedGroups.length}</strong> Categories</span></div>
    ${sections || `<p class="catalog-note">No products to display.</p>`}
    <div class="catalog-note">${esc(opts?.note ?? pricingNote)}</div>
    <footer class="footer">${esc(b.invoice_footer)}</footer>
  </body></html>`;

  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}
