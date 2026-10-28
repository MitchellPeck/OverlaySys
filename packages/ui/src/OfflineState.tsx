import type { CSSProperties, ReactNode } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "./Button";
import { colors, fontSize, fontWeight, radius } from "./tokens";
import { offlineCopy } from "./offlineCopy";

type Props = {
  noun?: string;
  variant?: "empty" | "stale";
  onRetry(): void;
  compact?: boolean;
  children?: ReactNode;
};

export function OfflineState({ noun, variant = "empty", onRetry, compact = false, children }: Props) {
  const { title, body } = offlineCopy(noun, variant);
  const retry = (
    <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={onRetry}>
      Retry
    </Button>
  );
  if (variant === "stale") {
    const bar: CSSProperties = {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "4px 8px",
      marginBottom: 8,
      background: colors.surface2,
      border: `1px solid ${colors.border}`,
      borderRadius: radius.md,
      fontSize: fontSize.sm,
      color: colors.textDim,
    };
    return (
      <div>
        <div role="status" style={bar}>
          <WifiOff size={14} aria-hidden style={{ color: colors.warn, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>
            <span style={{ color: colors.text, fontWeight: fontWeight.semibold }}>{title}.</span> {body}
          </span>
          {retry}
        </div>
        {children}
      </div>
    );
  }
  const box: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    textAlign: "center",
    padding: compact ? 16 : 48,
    color: colors.textDim,
    fontSize: fontSize.md,
  };
  return (
    <div role="status" style={box}>
      <WifiOff size={compact ? 18 : 24} aria-hidden style={{ color: colors.textMuted }} />
      <div style={{ color: colors.text, fontWeight: fontWeight.semibold }}>{title}</div>
      <div style={{ fontSize: fontSize.sm }}>{body}</div>
      {retry}
      {children}
    </div>
  );
}
