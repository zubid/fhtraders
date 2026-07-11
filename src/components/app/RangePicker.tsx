import { PRESETS, type Preset } from "@/lib/date-range";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RangePicker({
  preset, setPreset, custom, setCustom,
}: {
  preset: Preset;
  setPreset: (p: Preset) => void;
  custom: { from: string; to: string };
  setCustom: (c: { from: string; to: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 rounded-lg border border-border p-1">
        {PRESETS.map((p) => (
          <Button key={p.value} size="sm" variant={preset === p.value ? "default" : "ghost"} onClick={() => setPreset(p.value)}>
            {p.label}
          </Button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex items-center gap-2">
          <Input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="w-40" />
          <span className="text-muted-foreground">–</span>
          <Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="w-40" />
        </div>
      )}
    </div>
  );
}