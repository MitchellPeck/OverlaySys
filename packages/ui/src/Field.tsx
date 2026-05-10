import type { CSSProperties, ReactNode } from "react";
import { colors, fontSize, fontWeight, space } from "./tokens";

type Props = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  layout?: "stacked" | "inline";
  /** Fixed label column width when layout="inline". Defaults to 100. */
  labelWidth?: number;
  children: ReactNode;
  style?: CSSProperties;
  htmlFor?: string;
};

/**
 * Form field wrapper with a label, optional hint/error, and consistent spacing.
 * Replaces the three inline `Field` defs that lived in TakePanel.tsx,
 * songs/edit/page.tsx, and songs/ImportFromFileModal.tsx.
 */
export function Field({
  label,
  hint,
  error,
  layout = "stacked",
  labelWidth = 100,
  children,
  style,
  htmlFor,
}: Props) {
  if (layout === "inline") {
    return (
      <label
        htmlFor={htmlFor}
        style={{
          display: "flex",
          alignItems: "center",
          gap: space[2],
          marginBottom: space[2],
          ...style,
        }}
      >
        {label !== undefined && (
          <span
            style={{
              width: labelWidth,
              flexShrink: 0,
              fontSize: fontSize.sm,
              color: colors.textDim,
            }}
          >
            {label}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {children}
          <FieldFooter hint={hint} error={error} />
        </div>
      </label>
    );
  }

  return (
    <label
      htmlFor={htmlFor}
      style={{ display: "block", marginBottom: space[2] + 2, ...style }}
    >
      {label !== undefined && (
        <div
          style={{
            fontSize: fontSize.sm,
            color: colors.textDim,
            marginBottom: 4,
            fontWeight: fontWeight.regular,
          }}
        >
          {label}
        </div>
      )}
      {children}
      <FieldFooter hint={hint} error={error} />
    </label>
  );
}

function FieldFooter({ hint, error }: { hint?: ReactNode; error?: ReactNode }) {
  if (!hint && !error) return null;
  return (
    <div
      style={{
        marginTop: 4,
        fontSize: fontSize.xs,
        color: error ? colors.errorText : colors.textDim,
      }}
    >
      {error ?? hint}
    </div>
  );
}
