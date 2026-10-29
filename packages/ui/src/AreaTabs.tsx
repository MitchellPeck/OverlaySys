import type { ComponentType, CSSProperties, MouseEvent, ReactNode } from "react";
import { colors, fontSize, fontWeight, radius } from "./tokens";

export type AreaTabItem<T extends string> = {
  id: T;
  label: string;
  tone: "onair" | "brand";
  /** Route for this area. When set the item renders as a link (middle-click / open-in-new-window work). */
  href?: string;
  /** Small on-air dot after the label (e.g. Live while program has content). */
  dot?: boolean;
};

type LinkLike = ComponentType<{
  href: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  style?: CSSProperties;
  "aria-current"?: "page" | undefined;
  children?: ReactNode;
}>;

const DefaultLink: LinkLike = (p) => <a {...p} />;

/**
 * Live · Library · Settings switcher in the shell top bar. These are route
 * changes, so they're navigation links with aria-current — not ARIA tabs
 * (tabs imply panels in this page and arrow-key roving focus).
 */
export function AreaTabs<T extends string>({
  items,
  active,
  onSelect,
  linkComponent,
  ariaLabel = "Areas",
}: {
  items: AreaTabItem<T>[];
  active: T | null;
  /** Plain click handler. For linked items the default navigation is prevented first. */
  onSelect: (id: T) => void;
  /** Link implementation for `href` items (e.g. next/link so basePath applies). Defaults to <a>. */
  linkComponent?: LinkLike;
  ariaLabel?: string;
}) {
  const LinkEl: LinkLike = linkComponent ?? DefaultLink;
  return (
    <nav
      aria-label={ariaLabel}
      style={{
        display: "flex",
        gap: 2,
        padding: 2,
        background: colors.surface2,
        border: `1px solid ${colors.borderStrong}`,
        borderRadius: radius.md,
        flexShrink: 0,
      }}
    >
      {items.map((it) => {
        const on = it.id === active;
        const label = (
          <>
            {it.label}
            {it.dot && (
              <span
                data-testid={`area-dot-${it.id}`}
                aria-label="on air"
                role="img"
                style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: colors.onair, marginLeft: 6, verticalAlign: "middle", boxShadow: on ? "0 0 0 1px #fff" : "none" }}
              />
            )}
          </>
        );
        const style: CSSProperties = {
          display: "inline-block",
          padding: "4px 12px",
          border: "none",
          borderRadius: radius.sm,
          cursor: "pointer",
          textDecoration: "none",
          fontSize: fontSize.xs,
          fontWeight: fontWeight.semibold,
          // *Fill tokens keep white text at AA (white on --onair is 3.6:1).
          background: on ? (it.tone === "onair" ? colors.onairFill : colors.brandFill) : "transparent",
          color: on ? "#fff" : colors.textDim,
        };
        if (it.href !== undefined) {
          return (
            <LinkEl
              key={it.id}
              href={it.href}
              aria-current={on ? "page" : undefined}
              style={style}
              onClick={(e) => {
                // Let modified clicks (new window/tab) through untouched.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                onSelect(it.id);
              }}
            >
              {label}
            </LinkEl>
          );
        }
        return (
          <button
            key={it.id}
            type="button"
            aria-current={on ? "page" : undefined}
            onClick={() => onSelect(it.id)}
            style={style}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}
