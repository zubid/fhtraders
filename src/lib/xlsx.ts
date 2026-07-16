// Lightweight "Excel" export by writing an HTML table with the .xls MIME.
// Opens correctly in Excel, Numbers, Google Sheets. No dependency required.

function esc(v: any): string {
  return String(v ?? "").replace(/[&<>]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string),
  );
}

export function downloadExcel(
  filename: string,
  headers: string[],
  rows: (string | number)[][],
  title?: string,
) {
  const thead = `<tr>${headers.map((h) => `<th style="background:#0f766e;color:#fff;padding:6px;border:1px solid #999">${esc(h)}</th>`).join("")}</tr>`;
  const tbody = rows
    .map(
      (r) =>
        `<tr>${r.map((c) => `<td style="padding:4px;border:1px solid #ccc">${esc(c)}</td>`).join("")}</tr>`,
    )
    .join("");
  const html =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">` +
    `<head><meta charset="utf-8"/></head><body>` +
    (title ? `<h3>${esc(title)}</h3>` : "") +
    `<table>${thead}${tbody}</table></body></html>`;
  const blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}