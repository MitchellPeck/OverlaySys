"use client";
import { useId, type ReactNode } from "react";
import { Check } from "lucide-react";
import { colors, fontSize, radius } from "./tokens";

type Props = {
  checked: boolean;
  onChange(b: boolean): void;
  label?: ReactNode;
  disabled?: boolean;
  "aria-label"?: string;
};

function Row({
  label,
  disabled,
  onToggle,
  labelId,
  children,
}: {
  label?: ReactNode;
  labelId?: string;
  disabled?: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        minHeight: 24,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        fontSize: fontSize.sm,
        color: colors.text,
      }}
      onClick={(e) => {
        // The control itself is a button; only handle clicks on the label text.
        if (disabled || e.target === e.currentTarget.firstChild) return;
        if ((e.target as HTMLElement).closest("button")) return;
        onToggle();
      }}
    >
      {children}
      {label !== undefined && <span id={labelId}>{label}</span>}
    </span>
  );
}

export function Switch({ checked, onChange, label, disabled, "aria-label": ariaLabel }: Props) {
  const labelId = useId();
  return (
    <Row labelId={labelId} label={label} disabled={disabled} onToggle={() => onChange(!checked)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        aria-labelledby={!ariaLabel && label !== undefined ? labelId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          position: "relative",
          width: 28,
          height: 16,
          padding: 0,
          flexShrink: 0,
          border: `1px solid ${checked ? colors.brandFill : colors.border}`,
          borderRadius: radius.pill,
          background: checked ? colors.brandFill : colors.control,
          cursor: "inherit",
          boxSizing: "border-box",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 1,
            left: checked ? 13 : 1,
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 120ms",
          }}
        />
      </button>
    </Row>
  );
}

export function Checkbox({ checked, onChange, label, disabled, "aria-label": ariaLabel }: Props) {
  const labelId = useId();
  return (
    <Row labelId={labelId} label={label} disabled={disabled} onToggle={() => onChange(!checked)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={ariaLabel}
        aria-labelledby={!ariaLabel && label !== undefined ? labelId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          width: 16,
          height: 16,
          padding: 0,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: `1px solid ${checked ? colors.brandFill : colors.borderStrong}`,
          borderRadius: radius.sm,
          background: checked ? colors.brandFill : colors.surface2,
          color: "#fff",
          cursor: "inherit",
          boxSizing: "border-box",
        }}
      >
        {checked && <Check size={12} strokeWidth={3} aria-hidden />}
      </button>
    </Row>
  );
}
