import type { CSSProperties, ReactNode } from "react";
import { colors, fontSize, fontWeight, radius, space } from "./tokens";

type Padding = "sm" | "md" | "lg";

const PAD: Record<Padding, number> = {
  sm: space[2],
  md: space[3],
  lg: space[4],
};

type Props = {
  padding?: Padding;
  bordered?: boolean;
  background?: string;
  title?: ReactNode;
  /** Optional actions slot rendered to the right of the title. */
  actions?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
};

/**
 * Bordered container for forms and section cards. Replaces the ad-hoc
 * `<fieldset>` blocks in songs/edit and the section wrappers in
 * shows/edit, design/edit, channels.
 */
export function Panel({
  padding = "md",
  bordered = true,
  background,
  title,
  actions,
  children,
  style,
}: Props) {
  const base: CSSProperties = {
    background: background ?? colors.panel,
    border: bordered ? `1px solid ${colors.border}` : "none",
    borderRadius: radius.lg,
    padding: PAD[padding],
  };
  return (
    <section style={{ ...base, ...style }}>
      {(title !== undefined || actions !== undefined) && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: space[2],
            marginBottom: space[2],
          }}
        >
          {title !== undefined && (
            <h3
              style={{
                margin: 0,
                fontSize: fontSize.base,
                fontWeight: fontWeight.semibold,
                color: colors.text,
                flex: 1,
              }}
            >
              {title}
            </h3>
          )}
          {actions !== undefined && <div>{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
