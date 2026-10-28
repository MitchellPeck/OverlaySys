import type { CSSProperties } from "react";

export type PageBodyVariant = "form" | "wide" | "list";

const MAX_WIDTH: Record<PageBodyVariant, number | undefined> = {
  form: 760,
  wide: 1100,
  list: undefined,
};

/** Style for a variant page body: left-aligned, padding 24, flex column gap 16. */
export function pageBodyStyle(variant: PageBodyVariant): CSSProperties {
  return {
    overflow: "auto",
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    maxWidth: MAX_WIDTH[variant],
  };
}
