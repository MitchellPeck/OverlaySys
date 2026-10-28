import { Select } from "@overlaysys/ui";
import { fontWeightOptions } from "./fontWeights";

export function FontWeightSelect({
  value,
  onChange,
  available,
  id,
  "aria-label": ariaLabel = "Font weight",
}: {
  value: number;
  onChange: (v: number) => void;
  available?: number[];
  id?: string;
  "aria-label"?: string;
}) {
  const opts = fontWeightOptions(available);
  const hasValue = opts.some((o) => o.value === value);
  return (
    <Select id={id} aria-label={ariaLabel} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {!hasValue && <option value={value}>{value}</option>}
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
