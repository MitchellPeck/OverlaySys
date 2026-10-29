"use client";

import { useId } from "react";
import type { DeckLicensing } from "@overlaysys/core";
import { Input, SegmentedControl, colors, fontSize } from "@overlaysys/ui";

type Kind = DeckLicensing["kind"];

const OPTIONS: { value: Kind; label: string }[] = [
  { value: "ccli", label: "Yes, CCLI" },
  { value: "public-domain", label: "Public domain" },
  { value: "own", label: "Our own words" },
];

/** The licensing question for a deck. `null` = not answered yet (there is no default). */
export function LicensingField({
  value,
  onChange,
}: {
  value: DeckLicensing | null;
  onChange(v: DeckLicensing): void;
}) {
  const numberId = useId();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div aria-hidden style={{ fontSize: fontSize.sm, color: colors.textDim }}>
        Is this covered by your CCLI licence?
      </div>
      <div>
        <SegmentedControl<Kind | "">
          aria-label="Is this covered by your CCLI licence?"
          value={value?.kind ?? ""}
          options={OPTIONS}
          onChange={(k) => {
            if (!k || k === value?.kind) return;
            onChange(k === "ccli" ? { kind: "ccli" } : { kind: k });
          }}
        />
      </div>
      {value?.kind === "ccli" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
          <label htmlFor={numberId} style={{ fontSize: fontSize.sm, color: colors.textDim }}>
            CCLI song number (optional)
          </label>
          <Input
            id={numberId}
            size="md"
            inputMode="numeric"
            value={value.ccliNumber ?? ""}
            onChange={(e) => onChange({ kind: "ccli", ccliNumber: e.target.value })}
            style={{ maxWidth: 200 }}
          />
        </div>
      ) : null}
      <div style={{ fontSize: fontSize.xs, color: colors.textMuted }}>
        Only CCLI decks are added to your CCLI usage report.
      </div>
    </div>
  );
}
