# UI Overhaul — Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin OverlaySys's operator UI to match Ovation OS's identity (slate-dark base, Geist type, indigo/emerald brand, red reserved for on-air) by rebuilding the theme token layer and the `packages/ui` primitives — with zero required app-screen changes.

**Architecture:** All recoloring happens at one seam — `apps/operator/src/app/globals.css` (CSS custom properties) and `packages/ui/src/tokens.ts` (the typed contract the primitives read). Old token/var names are preserved as aliases pointing at new semantic vars, so the ~65 direct `var(--…)` sites and every `colors.*` inline style inherit the new look untouched. Primitives get surgical edits only where a hardcoded value or a new variant is involved. Geist fonts are wired via `next/font`.

**Tech Stack:** Next.js 15, React 19, TypeScript, `geist` font package, Vitest (node env).

## Global Constraints

- **No public-API changes to primitives.** Only additive changes allowed: a `success` Button variant and new `PillTone` values. Existing props/signatures unchanged.
- **No layout, route, IA, navigation, or app-screen composition changes.** Foundation only.
- **Preserve every pre-overhaul token name** in `tokens.ts` (`bg, panel, panel2, border, text, textDim, accent, accent2, green, red, warn, errorText`) and every pre-overhaul CSS var name used directly by app code (`--panel, --panel-2, --accent, --accent-2, --green, --red, --bg, --border, --text, --text-dim`). Removing any is a regression.
- **`colors.accent` intentionally flips red → indigo** (`var(--brand)`). General accents become indigo; only true on-air/stop affordances use `colors.onair` / `colors.danger`.
- **Palette values are exact** (approved via visual companion) — see Task 1.
- **Verification:** `pnpm typecheck` and `pnpm test` must stay green; final visual walk of every route via the `/run` skill.
- No new styling framework (no Tailwind/CSS Modules). No new shared components. No light theme.

---

### Task 1: Expand the theme token layer (globals.css + tokens.ts + contract test)

The crux. Defines all new semantic CSS vars, keeps old var names as aliases, adds a global focus-ring rule, rewrites `tokens.ts` to point at the new vars while preserving legacy names, and locks the backward-compat contract with a unit test.

**Files:**
- Modify: `apps/operator/src/app/globals.css` (full replace)
- Modify: `packages/ui/src/tokens.ts` (full replace)
- Create: `packages/ui/src/tokens.test.ts`

**Interfaces:**
- Produces (consumed by all later tasks and by app code):
  - CSS vars on `:root`: `--bg --surface --surface-2 --surface-3 --border --border-strong --text --text-dim --text-muted --brand --brand-hover --brand-subtle --ok --ok-subtle --warn --danger --onair --grad-brand --shadow-modal --font-sans --font-mono`, plus legacy aliases `--panel --panel-2 --accent --accent-2 --green --red`.
  - `tokens.ts` exports: `space`, `radius` (`{sm:6,md:8,lg:10,xl:14,pill:999}`), `fontSize`, `fontWeight`, `lineHeight`, `colors` (new names + legacy aliases), `shadow` (`{modal}`), `fontFamily` (`{sans,mono}`), `control`, types `ControlSize`, `SpaceKey`.

- [ ] **Step 1: Write the failing contract test**

Create `packages/ui/src/tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { colors, radius, fontFamily } from "./tokens";

describe("token backward-compatibility contract", () => {
  it("preserves every pre-overhaul color name as a CSS var", () => {
    const legacy = [
      "bg", "panel", "panel2", "border", "text", "textDim",
      "accent", "accent2", "green", "red", "warn", "errorText",
    ] as const;
    for (const key of legacy) {
      expect(colors[key], key).toMatch(/^var\(--/);
    }
  });

  it("flips legacy accent to the indigo brand", () => {
    expect(colors.accent).toBe("var(--brand)");
    expect(colors.accent).toBe(colors.brand);
  });

  it("adds the new console color names", () => {
    const added = [
      "surface", "surface2", "surface3", "borderStrong", "textMuted",
      "brand", "brandHover", "brandSubtle", "ok", "okSubtle", "onair", "gradBrand",
    ] as const;
    for (const key of added) {
      expect(colors[key], key).toMatch(/^var\(--/);
    }
  });

  it("exposes Geist font-family tokens", () => {
    expect(fontFamily.sans).toContain("Geist");
    expect(fontFamily.mono).toContain("Geist Mono");
  });

  it("uses the 10px radius family", () => {
    expect(radius.lg).toBe(10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run packages/ui/src/tokens.test.ts`
Expected: FAIL — `colors.brand`, `colors.ok`, `fontFamily`, etc. don't exist yet (type errors / undefined).

- [ ] **Step 3: Rewrite `packages/ui/src/tokens.ts`**

Full replacement:

```ts
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
  sans: "var(--font-sans)",
  mono: "var(--font-mono)",
} as const;

// Control sizes — unchanged shape from the pre-overhaul tokens.
export const control = {
  sm: { padX: 10, padY: 6, fontSize: fontSize.sm, radius: radius.md },
  md: { padX: 12, padY: 8, fontSize: fontSize.md, radius: radius.md },
  lg: { padX: 12, padY: 10, fontSize: fontSize.md, radius: radius.md },
} as const;

export type ControlSize = keyof typeof control;
export type SpaceKey = keyof typeof space;
```

- [ ] **Step 4: Rewrite `apps/operator/src/app/globals.css`**

Full replacement:

```css
:root {
  /* ── Surfaces ── */
  --bg: #0a0e17;
  --surface: #141a29;
  --surface-2: #1c2334;
  --surface-3: #232b3e;

  /* ── Borders ── */
  --border: rgba(255, 255, 255, 0.09);
  --border-strong: rgba(255, 255, 255, 0.16);

  /* ── Text ── */
  --text: #f5f7fb;
  --text-dim: #9aa6bd;
  --text-muted: #6b7688;

  /* ── Brand & state ── */
  --brand: #6366f1;
  --brand-hover: #7c7ff5;
  --brand-subtle: rgba(99, 102, 241, 0.16);
  --ok: #10b981;
  --ok-subtle: rgba(16, 185, 129, 0.16);
  --warn: #f59e0b;
  --danger: #ef4444;
  --onair: #ff3341;

  /* ── Signature gradient (logo / brand accents) ── */
  --grad-brand: linear-gradient(135deg, #6366f1, #10b981);

  /* ── Elevation ── */
  --shadow-modal: 0 12px 40px rgba(0, 0, 0, 0.55);

  /* ── Fonts — next/font sets --font-geist-sans / --font-geist-mono on <html>.
        The var() fallbacks keep text readable if the package fails to load. ── */
  --font-sans: var(--font-geist-sans, system-ui), -apple-system, "Segoe UI", sans-serif;
  --font-mono: var(--font-geist-mono, ui-monospace), SFMono-Regular, Menlo, monospace;

  /* ── Backward-compat aliases: pre-overhaul var names used directly by ~65
        inline style={{}} sites in apps/operator. Keep them pointed at the new
        semantic vars so those sites inherit the new look untouched. ── */
  --panel: var(--surface);
  --panel-2: var(--surface-2);
  --accent: var(--brand);
  --accent-2: var(--warn);
  --green: var(--ok);
  --red: var(--danger);
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 14px;
  height: 100%;
}

button {
  font: inherit;
  cursor: pointer;
}
input, textarea {
  font: inherit;
}

/* Consistent indigo focus ring for all controls (replaces per-component
   focus handling; primitives rely on this). */
:where(button, [role="button"], a, input, select, textarea):focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 1px;
}
:where(input, select, textarea):focus-visible {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-subtle);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run packages/ui/src/tokens.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @overlaysys/ui typecheck && pnpm --filter @overlaysys/operator typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/operator/src/app/globals.css packages/ui/src/tokens.ts packages/ui/src/tokens.test.ts
git commit -m "feat(ui): expand theme token layer to Ovation-matched console palette

New semantic CSS vars (slate surfaces, indigo/emerald brand, on-air red),
legacy var/token names kept as aliases, global indigo focus ring, and a
backward-compat contract test.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wire Geist fonts

**Files:**
- Modify: `apps/operator/package.json` (add `geist` dependency)
- Modify: `apps/operator/src/app/layout.tsx`

**Interfaces:**
- Consumes: `--font-sans` / `--font-mono` from Task 1 (which read `--font-geist-sans` / `--font-geist-mono`).
- Produces: `--font-geist-sans` and `--font-geist-mono` set on `<html>`.

- [ ] **Step 1: Add the geist package**

Run: `pnpm --filter @overlaysys/operator add geist`
Expected: `geist` appears in `apps/operator/package.json` dependencies; lockfile updates.

- [ ] **Step 2: Wire the fonts in `layout.tsx`**

Replace `apps/operator/src/app/layout.tsx` with:

```tsx
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { CloudBoot } from "./components/CloudBoot";

export const metadata = {
  title: "OverlaySys Operator",
  description: "Broadcast graphics control surface.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <CloudBoot>{children}</CloudBoot>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @overlaysys/operator typecheck`
Expected: no errors.

- [ ] **Step 4: Verify the font loads (visual smoke test)**

Run: `pnpm --filter @overlaysys/operator dev` and open `http://localhost:3000`.
Expected: body text renders in Geist (rounded, geometric grotesque), not the previous Inter/system stack. Stop the dev server after confirming.
(No unit test — font wiring is only observable at runtime.)

- [ ] **Step 5: Commit**

```bash
git add apps/operator/package.json apps/operator/src/app/layout.tsx pnpm-lock.yaml
git commit -m "feat(ui): wire Geist Sans/Mono via next/font

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Add the emerald `success` Button variant

**Files:**
- Modify: `packages/ui/src/Button.tsx`

**Interfaces:**
- Consumes: `colors.ok` (Task 1).
- Produces: `ButtonVariant` union gains `"success"`.

- [ ] **Step 1: Add `"success"` to the variant type**

In `packages/ui/src/Button.tsx`, change:

```ts
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "destructive";
```
to:
```ts
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "destructive" | "success";
```

- [ ] **Step 2: Add the `success` case to `variantStyle`**

In the `switch (v)` in `variantStyle`, add before the closing brace:

```ts
    case "success":
      return { background: colors.ok, color: "#04231a", borderColor: colors.ok };
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @overlaysys/ui typecheck`
Expected: no errors (the switch is now exhaustive over the widened union).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/Button.tsx
git commit -m "feat(ui): add emerald success Button variant

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Add console pill tones (Pill + StatusDot)

Adds `live` (filled red + glow), `ready` (emerald), `cued` (indigo), `off` (dim) tones and gives `ready`/`cued`/`live` subtle fills matching the approved mockup. Existing tones remap through Task 1 automatically.

**Files:**
- Modify: `packages/ui/src/Pill.tsx`

**Interfaces:**
- Consumes: `colors.ok`, `colors.brand`, `colors.danger`, `colors.onair`, `colors.okSubtle`, `colors.brandSubtle`, `colors.textDim`, `colors.text` (Task 1).
- Produces: `PillTone` union gains `"live" | "ready" | "cued" | "off"`.

- [ ] **Step 1: Widen the `PillTone` union and remap tones**

In `packages/ui/src/Pill.tsx`, replace:

```ts
export type PillTone = "neutral" | "good" | "warn" | "bad" | "accent" | "dim";
```
with:
```ts
export type PillTone =
  | "neutral" | "good" | "warn" | "bad" | "accent" | "dim"
  | "live" | "ready" | "cued" | "off";
```

Replace the `TONE` record with:

```ts
const TONE: Record<PillTone, string> = {
  neutral: colors.text,
  dim: colors.textDim,
  good: colors.ok,
  warn: colors.warn,
  bad: colors.danger,
  accent: colors.brand,
  live: colors.onair,
  ready: colors.ok,
  cued: colors.brand,
  off: colors.textDim,
};
```

- [ ] **Step 2: Give `live`/`ready`/`cued` fills + glow in `Pill`**

In the `Pill` function, replace the `base` style object with:

```ts
  const filled = tone === "live";
  const fill =
    tone === "live"
      ? colors.onair
      : tone === "ready"
      ? colors.okSubtle
      : tone === "cued"
      ? colors.brandSubtle
      : "transparent";
  const base: CSSProperties = {
    fontSize: fontSize.xs,
    padding: "3px 10px",
    borderRadius: radius.pill,
    border: `1px solid ${color}`,
    color: filled ? "#fff" : color,
    background: fill,
    boxShadow: filled ? "0 0 12px rgba(255, 51, 65, 0.5)" : undefined,
    fontWeight: fontWeight.semibold,
    textTransform: uppercase ? "uppercase" : undefined,
    letterSpacing: uppercase ? 1 : undefined,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    textDecoration: "none",
  };
```

(`StatusDot` needs no change — it reads `TONE[tone]` and now supports the new tones automatically.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @overlaysys/ui typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/Pill.tsx
git commit -m "feat(ui): add live/ready/cued/off pill tones with console styling

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Mono keycap look for Kbd

**Files:**
- Modify: `packages/ui/src/Kbd.tsx`

**Interfaces:**
- Consumes: `colors.surface2`, `colors.borderStrong`, `colors.textDim`, `fontFamily.mono` (Task 1).

- [ ] **Step 1: Update the Kbd `base` style**

In `packages/ui/src/Kbd.tsx`, update the import to include `fontFamily`:

```ts
import { colors, fontFamily, fontSize, radius } from "./tokens";
```

Replace the `base` object with:

```ts
  const base: CSSProperties = {
    display: "inline-block",
    padding: "1px 6px",
    background: colors.surface2,
    border: `1px solid ${colors.borderStrong}`,
    borderBottomWidth: 2,
    borderRadius: radius.sm,
    color: colors.textDim,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.xs,
    lineHeight: 1.4,
  };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @overlaysys/ui typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/Kbd.tsx
git commit -m "feat(ui): give Kbd a mono keycap look

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Indigo selected-row treatment in Table

`Tr` hardcodes a red selected background (`rgba(255,58,58,0.12)`) and a `colors.accent` left border. With `accent` now indigo, the two clash. Move both onto the brand tokens.

**Files:**
- Modify: `packages/ui/src/Table.tsx`

**Interfaces:**
- Consumes: `colors.brandSubtle`, `colors.brand` (Task 1).

- [ ] **Step 1: Update the `Tr` selected style**

In `packages/ui/src/Table.tsx`, replace the `base` assignment inside `Tr`:

```ts
  const base: CSSProperties = selected
    ? {
        background: colors.brandSubtle,
        borderLeft: `3px solid ${colors.brand}`,
        cursor: "pointer",
      }
    : { borderLeft: "3px solid transparent", cursor: "pointer" };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @overlaysys/ui typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/Table.tsx
git commit -m "feat(ui): indigo selected-row treatment in Table

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Backward-compat sweep of hardcoded hex in the operator app

Eight files hardcode hex that bypasses tokens. Map the surface colors onto vars; leave genuine non-theme colors (OBS/NDI chroma-key pickers, white text). No layout changes.

**Files (modify):**
- `apps/operator/src/app/components/ChannelPreview.tsx`
- `apps/operator/src/app/components/Rundown.tsx`
- `apps/operator/src/app/channels/page.tsx`
- `apps/operator/src/app/design/edit/page.tsx`
- `apps/operator/src/app/components/AccountMenu.tsx`
- `apps/operator/src/app/account/page.tsx`
- `apps/operator/src/app/components/CloudBoot.tsx`
- `apps/operator/src/lib/FieldInput.tsx`

- [ ] **Step 1: Locate every hex hit**

Run: `grep -rnoE "#[0-9a-fA-F]{6}" apps/operator/src --include="*.tsx" --include="*.ts"`
Expected: the hits enumerated below.

- [ ] **Step 2: Apply this exact mapping (review each hit)**

Replace the string on the left with the string on the right, in the listed files:

| Hardcoded hex | Replace with | Where |
|---|---|---|
| `#0c0d10` | `var(--bg)` | ChannelPreview.tsx, Rundown.tsx, channels/page.tsx |
| `#0a0b0e` | `var(--bg)` | design/edit/page.tsx |
| `#1a1c20` | `var(--surface-2)` | ChannelPreview.tsx, Rundown.tsx, channels/page.tsx |
| `#f0b95c` | `var(--warn)` | AccountMenu.tsx, account/page.tsx |
| `#f0556b` | `var(--danger)` | AccountMenu.tsx |
| `#f87171` | `var(--danger)` | CloudBoot.tsx |

**Leave unchanged** (genuine non-theme colors):
- `channels/page.tsx` `#000000`, `#00ff00`, `#0000ff` — OBS/NDI background/chroma-key color pickers.
- All `#ffffff` — white text/fills on colored backgrounds (FieldInput.tsx, design/edit/page.tsx, channels/page.tsx).

For each replacement, confirm the hex sits in a `style` value (a color/background/border), not in data (e.g. a saved template's own color field). If a hit is a user-data default rather than chrome, leave it and note it.

- [ ] **Step 3: Confirm no stray old surface hex remains**

Run: `grep -rnE "#0c0d10|#1a1c20|#0a0b0e|#ff3a3a|#ffb13a" apps/operator/src`
Expected: no matches.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @overlaysys/operator typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src
git commit -m "refactor(ui): move hardcoded surface hex onto theme tokens

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Full verification pass

Confirms the whole phase: green tests/typecheck and a visual walk of every route.

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: PASS, including `packages/ui/src/tokens.test.ts`.

- [ ] **Step 2: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Visual walk via the `/run` skill**

Launch the operator and walk every route: show mode (`/`), `/songs`, `/shows`, `/design`, `/hotcards`, `/projects`, `/timer`, `/stt`, `/channels`, `/account`, `/data`. For each, confirm:
- Background is the new slate (`#0a0e17`), text is legible.
- Interactive/selected states read **indigo**; positive/ready states read **emerald**; on-air/PGM and destructive read **red**.
- No leftover near-black `#0c0d10` panels or red selected-rows.
- Buttons, inputs (indigo focus ring), pills, tables, modals look consistent.

Note any clashing screen and fix it by nudging the offending value onto a token (still no layout changes), then re-run Steps 1–2.

- [ ] **Step 4: Final commit (only if Step 3 required fixes)**

```bash
git add -A
git commit -m "fix(ui): resolve visual clashes found in Foundation verification pass

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Primitives verified by inheritance (no code change)

These primitives are part of the spec's "primitive rebuild" but require **no
source edits** — they read only remapped tokens, so Task 1 restyles them
automatically. They are confirmed in the Task 8 visual walk, not by their own
tasks:

- **Panel / Modal** — surfaces (`colors.panel` → `--surface`), elevation
  (`shadow.modal` → `--shadow-modal`), radii (`radius.lg` → 10px), and header
  dividers (`colors.border`) all update through the token layer.
- **Input / Select / Textarea** — fills (`colors.panel2` → `--surface-2`),
  `invalid` border (`colors.red` → `--danger`), and radii update via tokens; the
  indigo focus ring + `--brand-subtle` glow come from the global `:focus-visible`
  rule in Task 1.
- **Field / PageHeader / EntityList / IconButton** — text, border, and surface
  tokens remap automatically.
- **Stack / Inline** — layout-only (no colors); nothing to change.

If the Task 8 walk surfaces a clash in any of these, fix it by nudging the
offending value onto a token — still no layout changes.

## Notes on testing approach

The operator test harness runs in Vitest's **node** environment with no jsdom/testing-library, and the spec explicitly states a theming change is validated visually, not by unit tests. Adding a browser test framework is out of scope for Foundation. Therefore:
- The **token layer** (pure TS) carries a real unit test (Task 1) guarding the critical backward-compat contract.
- **Primitive** changes are guarded by `pnpm typecheck` (catches API breakage) and the **visual walk** (Task 8). This is the honest, right-sized verification for a reskin — not a placeholder.
