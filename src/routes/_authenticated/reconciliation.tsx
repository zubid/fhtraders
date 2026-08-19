import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app/PageHeader";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/reconciliation")({
  component: Reconciliation,
});

const labels: Record<string, string> = {
  restaurant_payments_without_vault: "Restaurant payments without Vault User",
  supplier_payments_without_vault: "Supplier payments without Vault User",
  supplier_advances_unallocated: "Supplier advances / unallocated payments",
  void_legacy_supplier_payments: "Void / duplicate legacy payments",
  purchase_allocation_mismatches: "Purchase allocation mismatches",
  sale_payment_mismatches: "Sale/payment and ledger/summary discrepancies",
};

function Reconciliation() {
  const { data, isLoading } = useQuery({
    queryKey: ["financial-reconciliation"],
    queryFn: async () => {
      const { data, error } = await (
        supabase.from("financial_reconciliation" as any) as any
      ).select("*");
      if (error) throw error;
      return data as any[];
    },
  });
  return (
    <div>
      <PageHeader
        title="Financial Reconciliation"
        description="Admin integrity checks; investigate discrepancies rather than creating balancing transactions."
      />
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Check</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={3}>Checking ledgers…</TableCell>
                </TableRow>
              ) : (
                (data ?? []).map((r: any) => (
                  <TableRow key={r.issue}>
                    <TableCell>{labels[r.issue] ?? r.issue}</TableCell>
                    <TableCell className="text-right">{r.row_count}</TableCell>
                    <TableCell
                      className={`text-right font-medium ${Number(r.amount) ? "text-destructive" : "text-success"}`}
                    >
                      {formatCurrency(r.amount)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
