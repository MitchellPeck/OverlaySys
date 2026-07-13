// Spacing scale — index-keyed so call sites can write space[2] for "8px gap".
// 0:0  1:4  2:8  3:12  4:16  5:24  6:32
export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32 } as const;

// 10px base radius family, matching Ovation OS (--radius: 0.625rem).
export const radius = { sm: 6, md: 8, lg: 10, xl: 14, pill: 999 } as const;

export const fontSize = { xs: 11, sm: 12, md: 13, base: 14, lg: 16 } as const;

export const fontWeight = { regular: 400, medium: 500, semibold: 600 } as const;

export const lineHeight = { tight: 1.2, normal: 1.5 } as const;

// Colors are passthroughs to the CSS custom props in
// apps/operator/src/app/globals.css. New semantic names first, then the
// pre-overhaul aliases (kept so existing inline styles inherit the new look).
export const colors = {
  // surfaces
  bg: "var(--bg)",
  surface: "var(--surface)",
  surface2: "var(--surface-2)",
  surface3: "var(--surface-3)",
  // borders
  border: "var(--border)",
  borderStrong: "var(--border-strong)",
  // text
  text: "var(--text)",
  textDim: "var(--text-dim)",
  textMuted: "var(--text-muted)",
  // brand & state
  brand: "var(--brand)",
  brandHover: "var(--brand-hover)",
  brandSubtle: "var(--brand-subtle)",
  ok: "var(--ok)",
  okSubtle: "var(--ok-subtle)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  onair: "var(--onair)",
  gradBrand: "var(--grad-brand)",

  // ── Backward-compat aliases — DO NOT REMOVE.
  //    Consumed across apps/operator inline styles. ──
  panel: "var(--surface)",
  panel2: "var(--surface-2)",
  accent: "var(--brand)", // was red #ff3a3a → now indigo brand (intentional)
  accent2: "var(--warn)", // was amber #ffb13a → warn
  green: "var(--ok)",
  red: "var(--danger)",
  errorText: "var(--danger)",
} as const;

export const shadow = {
  modal: "var(--shadow-modal)",
} as const;

export const fontFamily = {
  sans: "var(--font-sans), Geist, sans-serif",
  mono: "var(--font-mono), Geist Mono, monospace",
} as const;

// Control sizes — unchanged shape from the pre-overhaul tokens.
export const control = {
  sm: { padX: 10, padY: 6, fontSize: fontSize.sm, radius: radius.md },
  md: { padX: 12, padY: 8, fontSize: fontSize.md, radius: radius.md },
  lg: { padX: 12, padY: 10, fontSize: fontSize.md, radius: radius.md },
} as const;

export type ControlSize = keyof typeof control;
export type SpaceKey = keyof typeof space;
