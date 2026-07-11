export type Preset = "today" | "week" | "month" | "quarter" | "year" | "custom";

export const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "quarter", label: "This Quarter" },
  { value: "year", label: "This Year" },
  { value: "custom", label: "Custom" },
];

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function rangeForPreset(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const to = iso(now);
  const start = new Date(now);
  switch (preset) {
    case "today":
      return { from: to, to };
    case "week": {
      const day = (now.getDay() + 6) % 7; // Monday start
      start.setDate(now.getDate() - day);
      return { from: iso(start), to };
    }
    case "month":
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to };
    case "quarter": {
      const q = Math.floor(now.getMonth() / 3) * 3;
      return { from: iso(new Date(now.getFullYear(), q, 1)), to };
    }
    case "year":
      return { from: iso(new Date(now.getFullYear(), 0, 1)), to };
    default:
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  }
}