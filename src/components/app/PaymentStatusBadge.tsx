import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PaymentStatus } from "@/lib/credit";

const LABELS: Record<PaymentStatus, string> = {
  paid: "Paid",
  partial: "Partially Paid",
  unpaid: "Unpaid",
};

const CLASSES: Record<PaymentStatus, string> = {
  paid: "bg-success/15 text-success border border-success/30",
  partial: "bg-warning/20 text-warning-foreground border border-warning/40",
  unpaid: "bg-destructive/15 text-destructive border border-destructive/30",
};

export function PaymentStatusBadge({ status }: { status: string }) {
  const s = (["paid", "partial", "unpaid"].includes(status) ? status : "unpaid") as PaymentStatus;
  return <Badge className={cn("font-medium", CLASSES[s])}>{LABELS[s]}</Badge>;
}
