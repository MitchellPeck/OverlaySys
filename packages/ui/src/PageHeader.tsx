import type { CSSProperties, ReactNode } from "react";
import { colors, fontSize, fontWeight, space } from "./tokens";

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  level?: 1 | 2;
  style?: CSSProperties;
};

/**
 * Standardized page / section header. Use `level=1` for a page title (h1, 16px),
 * `level=2` for a section header (h2, 14px).
 */
export function PageHeader({ title, subtitle, actions, level = 1, style }: Props) {
  const Tag: "h1" | "h2" = level === 1 ? "h1" : "h2";
  const titleSize = level === 1 ? fontSize.lg : fontSize.base;
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: space[2],
        marginBottom: space[3],
        ...style,
      }}
    >
      <Tag
        style={{
          margin: 0,
          fontSize: titleSize,
          fontWeight: fontWeight.semibold,
          color: colors.text,
        }}
      >
        {title}
      </Tag>
      {subtitle !== undefined && (
        <span style={{ fontSize: fontSize.md, color: colors.textDim }}>{subtitle}</span>
      )}
      {actions !== undefined && (
        <div style={{ marginLeft: "auto", display: "flex", gap: space[2] }}>{actions}</div>
      )}
    </header>
  );
}
