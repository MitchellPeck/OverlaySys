import type { CSSProperties, ReactNode } from "react";
import { colors, fontSize, fontWeight, radius, space } from "./tokens";

/**
 * Vertical list of entity rows used by the operator's index pages
 * (/shows, /songs, /design). Always paired with `<EntityRow>` items.
 */
export function EntityList({
  children,
  empty,
  style,
}: {
  children: ReactNode;
  empty?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, ...style }}>
      {children}
      {empty}
    </ul>
  );
}

/**
 * One row of an entity list: a primary clickable card (name + metadata line)
 * with optional right-aligned action buttons (Export, Delete, etc.).
 *
 * Pass `href` to make the card a Next.js-friendly anchor; pass `as` to
 * override the underlying tag. Card and actions are siblings so action
 * clicks don't trigger navigation.
 */
export function EntityRow({
  href,
  primary,
  secondary,
  actions,
  style,
}: {
  href?: string;
  primary: ReactNode;
  secondary?: ReactNode;
  actions?: ReactNode;
  style?: CSSProperties;
}) {
  const cardStyle: CSSProperties = {
    flex: 1,
    padding: `${space[3]}px ${space[3] + 2}px`,
    background: colors.panel,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.lg,
    color: colors.text,
    textDecoration: "none",
    display: "block",
    minWidth: 0,
  };
  const card = (
    <>
      <div
        style={{
          fontWeight: fontWeight.semibold,
          fontSize: fontSize.base,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {primary}
      </div>
      {secondary !== undefined && (
        <div
          style={{
            fontSize: fontSize.xs,
            color: colors.textDim,
            marginTop: 4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {secondary}
        </div>
      )}
    </>
  );

  return (
    <li
      style={{
        marginBottom: space[1],
        display: "flex",
        alignItems: "stretch",
        gap: space[1],
        ...style,
      }}
    >
      {href ? (
        <a href={href} style={cardStyle}>
          {card}
        </a>
      ) : (
        <div style={cardStyle}>{card}</div>
      )}
      {actions !== undefined && (
        <div style={{ display: "flex", gap: space[1], flexShrink: 0 }}>
          {actions}
        </div>
      )}
    </li>
  );
}
