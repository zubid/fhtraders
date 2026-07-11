import { Badge } from "@/components/ui/badge";
import { stockStatus, type StockStatus } from "@/lib/format";
import { cn } from "@/lib/utils";

const LABELS: Record<StockStatus, string> = {
  out: "Out of Stock",
  low: "Low Stock",
  high: "High Stock",
  normal: "Normal",
};

const CLASSES: Record<StockStatus, string> = {
  out: "bg-destructive text-destructive-foreground",
  low: "bg-warning text-warning-foreground",
  high: "bg-chart-5/15 text-chart-5 border border-chart-5/30",
  normal: "bg-success/15 text-success border border-success/30",
};

export function StockBadge({
  current,
  reorder,
  max,
}: {
  current: number;
  reorder: number;
  max: number;
}) {
  const status = stockStatus(current, reorder, max);
  return <Badge className={cn("font-medium", CLASSES[status])}>{LABELS[status]}</Badge>;
}