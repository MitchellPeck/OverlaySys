import { useId, type ReactNode } from "react";
import { colors } from "@overlaysys/ui";

export function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 28 }}>
      <label htmlFor={id} title={hint} style={{ width: 80, flexShrink: 0, fontSize: 11, color: colors.textDim }}>
        {label}
      </label>
      <div style={{ flex: 1, minWidth: 0 }}>{children(id)}</div>
    </div>
  );
}
