import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";

export type PickerProduct = {
  id: string;
  name: string;
  unit: string;
  sku?: string | null;
  current_stock?: number | string | null;
  categories?: { name?: string | null } | null;
};

export function ProductSearchPicker({
  products,
  excludeIds,
  onSelect,
  placeholder = "Search product by name, SKU or category...",
}: {
  products: PickerProduct[];
  excludeIds: string[];
  onSelect: (p: PickerProduct) => void;
  placeholder?: string;
}) {
  const [term, setTerm] = useState("");

  const results = useMemo(() => {
    if (!term.trim()) return [];
    const s = term.toLowerCase();
    return products
      .filter((p) => !excludeIds.includes(p.id))
      .filter(
        (p) =>
          p.name.toLowerCase().includes(s) ||
          (p.sku ?? "").toLowerCase().includes(s) ||
          (p.categories?.name ?? "").toLowerCase().includes(s),
      )
      .slice(0, 8);
  }, [products, excludeIds, term]);

  return (
    <div className="relative mb-4 max-w-md">
      <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input className="pl-9" placeholder={placeholder} value={term} onChange={(e) => setTerm(e.target.value)} />
      {results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onSelect(p);
                setTerm("");
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <span>
                <span className="font-medium">{p.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {p.sku ?? ""} {p.categories?.name ? `· ${p.categories.name}` : ""}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {p.current_stock != null ? `${formatNumber(Number(p.current_stock))} ${p.unit}` : p.unit}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
