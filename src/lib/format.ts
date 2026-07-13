// Runtime-configurable formatting driven by app settings.
let _currencySymbol = "AED";
let _dateFormat = "dd MMM yyyy";

export function setFormatConfig(cfg: { currencySymbol?: string; dateFormat?: string }) {
  if (cfg.currencySymbol) _currencySymbol = cfg.currencySymbol;
  if (cfg.dateFormat) _dateFormat = cfg.dateFormat;
}

export function getCurrencySymbol() {
  return _currencySymbol;
}

export function formatCurrency(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  const num = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
  return `${_currencySymbol} ${num}`;
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(n);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value.length <= 10 ? value + "T00:00:00" : value) : value;
  if (isNaN(d.getTime())) return "-";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  switch (_dateFormat) {
    case "dd/MM/yyyy":
      return `${dd}/${mm}/${yyyy}`;
    case "MM/dd/yyyy":
      return `${mm}/${dd}/${yyyy}`;
    case "yyyy-MM-dd":
      return `${yyyy}-${mm}-${dd}`;
    default:
      return `${dd} ${MONTHS[d.getMonth()]} ${yyyy}`;
  }
}

export type StockStatus = "out" | "low" | "high" | "normal";

export function stockStatus(
  current: number,
  reorder: number,
  max: number,
): StockStatus {
  if (current <= 0) return "out";
  if (reorder > 0 && current <= reorder) return "low";
  if (max > 0 && current >= max) return "high";
  return "normal";
}

export function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}