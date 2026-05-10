// Spacing scale — index-keyed so call sites can write space[2] for "8px gap".
// 0:0  1:4  2:8  3:12  4:16  5:24  6:32
export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32 } as const;

export const radius = { sm: 3, md: 4, lg: 6, pill: 999 } as const;

export const fontSize = { xs: 11, sm: 12, md: 13, base: 14, lg: 16 } as const;

export const fontWeight = { regular: 400, medium: 500, semibold: 600 } as const;

export const lineHeight = { tight: 1.2, normal: 1.5 } as const;

// Colors are passthroughs to the CSS custom props in apps/operator/src/app/globals.css.
// `warn` and `errorText` were previously hardcoded in three different files;
// promoting them here so call sites can stop sprinkling raw hex.
export const colors = {
  bg: "var(--bg)",
  panel: "var(--panel)",
  panel2: "var(--panel-2)",
  border: "var(--border)",
  text: "var(--text)",
  textDim: "var(--text-dim)",
  accent: "var(--accent)",
  accent2: "var(--accent-2)",
  green: "var(--green)",
  red: "var(--red)",
  warn: "#fbbf24",
  errorText: "#ef4444",
} as const;

export const shadow = {
  modal: "0 12px 40px rgba(0, 0, 0, 0.5)",
} as const;

// Control sizes — picked to match the most-common existing usage so the
// visual delta of migrating to <Button>/<Input> stays within a few pixels.
//   sm: songs/page.tsx btn() default (6px 10px, fontSize 12)
//   md: Rundown btn() (8px 10px → 8px 12px, fontSize 12 → 13)
//   lg: TakePanel Button (10px 12px, fontSize 12 → 13)
export const control = {
  sm: { padX: 10, padY: 6, fontSize: fontSize.sm, radius: radius.md },
  md: { padX: 12, padY: 8, fontSize: fontSize.md, radius: radius.md },
  lg: { padX: 12, padY: 10, fontSize: fontSize.md, radius: radius.md },
} as const;

export type ControlSize = keyof typeof control;
export type SpaceKey = keyof typeof space;
