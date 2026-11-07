export type PosExportRow = [string, string | number];
export type PosExportData = {
  businessDate: string;
  status: string;
  rows: PosExportRow[];
  disclaimer: string;
};
const escapeXml = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const safeName = (date: string) => date.replace(/[^0-9-]/g, "");
const save = (content: string, type: string, name: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
export function exportPosExcel(data: PosExportData) {
  // Excel 2003 XML spreadsheet, natively openable in Excel; no dependency.
  const rows: PosExportRow[] = [["Business date", data.businessDate], ["Status", data.status], ...data.rows, ["Scope", data.disclaimer]];
  const cells = rows.map(([label, value]) => {
    const type = typeof value === "number" && Number.isFinite(value) ? "Number" : "String";
    return `<Row><Cell><Data ss:Type="String">${escapeXml(label)}</Data></Cell><Cell><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell></Row>`;
  }).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="POS Day"><Table>${cells}</Table></Worksheet></Workbook>`;
  save(xml, "application/vnd.ms-excel;charset=utf-8", `pos-day-${safeName(data.businessDate)}.xls`);
}
export function printPosDay(data: PosExportData, receipt58mm: boolean) {
  const win = window.open("", "_blank", "noopener,noreferrer,width=700,height=850");
  if (!win) throw new Error("Allow pop-ups to print or save PDF.");
  const width = receipt58mm ? "58mm" : "190mm";
  const rows = data.rows.map(([name,value]) => `<tr><td>${escapeXml(name)}</td><td>${escapeXml(value)}</td></tr>`).join("");
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>POS ${escapeXml(data.businessDate)}</title>
<style>@page{size:${receipt58mm ? "58mm auto" : "A4"};margin:${receipt58mm ? "2mm" : "12mm"}}
body{font-family:Arial,sans-serif;width:${width};max-width:100%;margin:0 auto;color:#111;font-size:${receipt58mm ? "10px" : "12px"}}
h1{font-size:${receipt58mm ? "13px" : "20px"};margin:8px 0}
table{width:100%;border-collapse:collapse;table-layout:fixed}td{border-bottom:1px dashed #aaa;padding:5px 2px;overflow-wrap:anywhere}td:last-child{text-align:right;width:42%}
small{display:block;margin-top:12px;overflow-wrap:anywhere}button{margin:12px 0;padding:8px}
@media print{button{display:none}body{width:auto}}</style></head><body>
<h1>FH Traders — POS Day</h1><div>Date: ${escapeXml(data.businessDate)} | ${escapeXml(data.status)}</div>
<table>${rows}</table><small>${escapeXml(data.disclaimer)}</small>
<button onclick="window.print()">Print / Save as PDF</button></body></html>`);
  win.document.close();
}
