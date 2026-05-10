import type {
  CSSProperties,
  HTMLAttributes,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { colors, fontSize, fontWeight } from "./tokens";

type Size = "sm" | "md";

type TableProps = TableHTMLAttributes<HTMLTableElement> & {
  size?: Size;
};

export function Table({ size = "md", style, ...rest }: TableProps) {
  const base: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: size === "sm" ? fontSize.sm : fontSize.md,
  };
  return <table {...rest} style={{ ...base, ...style }} />;
}

type ThProps = ThHTMLAttributes<HTMLTableCellElement> & { size?: Size };
export function Th({ size = "md", style, ...rest }: ThProps) {
  const base: CSSProperties = {
    padding: size === "sm" ? "6px 8px" : "8px 10px",
    borderBottom: `1px solid ${colors.border}`,
    fontWeight: fontWeight.medium,
    fontSize: fontSize.xs,
    color: colors.textDim,
    textAlign: "left",
  };
  return <th {...rest} style={{ ...base, ...style }} />;
}

type TdProps = TdHTMLAttributes<HTMLTableCellElement> & { size?: Size };
export function Td({ size = "md", style, ...rest }: TdProps) {
  const base: CSSProperties = {
    padding: size === "sm" ? 6 : 8,
    borderBottom: `1px solid ${colors.border}`,
  };
  return <td {...rest} style={{ ...base, ...style }} />;
}

type TrProps = HTMLAttributes<HTMLTableRowElement> & { selected?: boolean };
export function Tr({ selected, style, ...rest }: TrProps) {
  const base: CSSProperties = selected
    ? {
        background: "rgba(255, 58, 58, 0.12)",
        borderLeft: `3px solid ${colors.accent}`,
        cursor: "pointer",
      }
    : { borderLeft: "3px solid transparent", cursor: "pointer" };
  return <tr {...rest} style={{ ...base, ...style }} />;
}
