# UI Overhaul — Phase 1: Foundation (theme + primitives)

**Date:** 2026-07-13
**Status:** Design — awaiting review
**Scope of this spec:** Phase 1 of a full UI redesign of the operator app. This
spec covers only the Foundation: the theme token layer, font wiring, and the
`packages/ui` primitive reskin. Phases 2–4 (app shell, Live workspace, Prep
workspace) get their own specs.

---

## Background

OverlaySys is a live broadcast graphics operator tool (an H2R replacement). The
operator UI is a Next.js app (`apps/operator`) with a dense, dark "control room"
show-mode grid (Rundown / Take / Channels) plus ~12 management routes (songs,
shows, design, hotcards, projects, timer, scripture/stt, channels, account,
data).

Today's styling is minimal and ad-hoc:

- `apps/operator/src/app/globals.css` — ~10 CSS custom properties (near-black
  `--bg`, red `--accent`).
- `packages/ui/src/tokens.ts` — a typed passthrough to those CSS vars, plus
  spacing/radius/type/control scales.
- `packages/ui/src/*.tsx` — 13 shared primitives (Button, IconButton, Input,
  Textarea, Select, Field, Modal, Panel, PageHeader, Table, Stack, Pill/
  StatusDot, Kbd, EntityList) styled via inline `style={{}}` reading from
  `tokens.ts`.
- App screens lean heavily on inline `style={{}}`, mostly pulling from
  `tokens.ts` but with some hardcoded hex.

## The larger redesign (context for this phase)

The user wants a complete overhaul: new styling, layout, theming, and structure.
Decisions locked during brainstorming:

- **Scope:** full redesign (styling + layout + information architecture).
- **Aesthetic:** modern broadcast console — dark, dense, refined; purposeful
  state color; glanceable for an operator working under pressure.
- **Styling tech:** keep the current architecture (CSS custom properties + a
  typed `tokens.ts` + `packages/ui` primitives), but done properly. No Tailwind,
  no CSS Modules, no new styling framework.
- **Navigation model:** two-tier — a **Live/Show** workspace and a **Prep/Manage**
  workspace, each with its own tailored layout and a clear toggle between them.
- **Brand identity:** match **Ovation OS** (sibling product). Ovation's app
  chrome is a shadcn "slate" theme (blue-tinted near-black dark mode, Geist
  Sans/Mono, 10px base radius); its brand identity is the **indigo `#6366F1` →
  emerald `#10B981`** pair (there is a literal `SPINNER_GRADIENT = { from:
  "#6366F1", to: "#10B981" }`). Indigo = brand/interactive, emerald =
  positive/success. Red is reserved for ON-AIR / destructive.

**Phased decomposition** (each phase = its own spec → plan → build → review):

1. **Foundation** (this spec) — theme token layer + fonts + `packages/ui`
   primitive reskin. No layout/IA changes; existing screens inherit the new look.
2. **App shell** — two-tier Live/Prep structure, navigation, workspace toggle,
   header/account.
3. **Live workspace** — redesign the show-mode operator screen.
4. **Prep workspace** — recompose the management routes (may introduce a lighter
   "prep" theme).

## Goals (this phase)

- Replace the dark/red palette with an Ovation-matched theme: slate-dark
  surfaces, Geist type, 10px-family radii, indigo/emerald brand, red reserved for
  ON-AIR/destructive.
- Rebuild all 13 `packages/ui` primitives against an expanded token layer with a
  refined broadcast-console look — **without changing their public APIs**.
- Ship the new look to every existing route with **zero required call-site
  changes**, by recoloring entirely through the token layer.

## Non-goals (this phase)

- No layout changes, no route/IA changes, no navigation, no new app shell.
- No component-composition changes inside app screens.
- No light theme (architected for, not built).
- No new shared components beyond the additive changes listed below.

---

## Design

### Approved palette

Locked via the visual companion. Values are the shipped defaults (slightly
deeper background than Ovation's app for dark-booth comfort; approved).

| Token | Value | Role |
|---|---|---|
| `--bg` | `#0a0e17` | App background |
| `--surface` | `#141a29` | Panel / card |
| `--surface-2` | `#1c2334` | Raised / input fill |
| `--surface-3` | `#232b3e` | Hover |
| `--border` | `rgba(255,255,255,.09)` | Default border |
| `--border-strong` | `rgba(255,255,255,.16)` | Emphasis border / controls |
| `--text` | `#f5f7fb` | Primary text |
| `--text-dim` | `#9aa6bd` | Secondary text |
| `--text-muted` | `#6b7688` | Tertiary / labels |
| `--brand` | `#6366f1` | Brand / primary / interactive / selected |
| `--brand-hover` | `#7c7ff5` | Brand hover |
| `--brand-subtle` | `rgba(99,102,241,.16)` | Selected-row bg, focus glow |
| `--ok` | `#10b981` | Positive / ready / go |
| `--ok-subtle` | `rgba(16,185,129,.16)` | Ready pill bg |
| `--warn` | `#f59e0b` | Warning |
| `--danger` | `#ef4444` | Destructive |
| `--onair` | `#ff3341` | ON-AIR / PGM tally |
| `--grad-brand` | `linear-gradient(135deg,#6366f1,#10b981)` | Signature gradient (logo/accents) |

Radii: `--r-sm:6px --r-md:8px --r-lg:10px --r-xl:14px` (base 10px, matching
Ovation's `--radius: 0.625rem`). Elevation: one soft modal/popover shadow token.

**ON-AIR treatment (approved):** the live/PGM channel wears a red glow + a
left edge bar, not a solid banner.

### 1. Token architecture

The recolor happens entirely at the token seam so no screen needs editing.

- **`globals.css`** grows from ~10 vars to the full set above, defined under
  `:root` with **semantic names** (not `--dark-*`) so a future light theme can
  override the same vars under `[data-theme="light"]`. Includes surfaces,
  borders, text, brand/state, gradient, radii, and a shadow.
- **`tokens.ts`** remains the typed contract and points every export at the new
  vars:
  - **Backward compatibility (critical):** the existing token names are all
    preserved and remapped to new values, so every current inline `style={{}}`
    keeps compiling and inherits the new look:
    - `colors.bg` → `--bg`; `colors.panel` → `--surface`; `colors.panel2` →
      `--surface-2`; `colors.border` → `--border`; `colors.text` → `--text`;
      `colors.textDim` → `--text-dim`; `colors.accent` → `--brand`;
      `colors.accent2` → `--warn` (was amber `#ffb13a`; closest semantic match);
      `colors.green` → `--ok`; `colors.red` → `--danger`; `colors.warn` →
      `--warn`; `colors.errorText` → `--danger`.
    - Note: `colors.accent` (formerly red `#ff3a3a`) now resolves to **indigo**.
      This is the intended global recolor — interactive accents become indigo;
      genuine on-air/stop affordances must use `colors.onair` / `colors.danger`.
      The compat sweep (below) catches any call site relying on `accent` to mean
      "live/red".
  - **New names added alongside:** `colors.surface3`, `colors.borderStrong`,
    `colors.textMuted`, `colors.brand`, `colors.brandHover`, `colors.brandSubtle`,
    `colors.ok`, `colors.okSubtle`, `colors.onair`, `colors.gradBrand`.
  - `radius`, `space`, `fontSize`, `fontWeight`, `shadow`, `control` updated to
    the new scale (radii shift to the 6/8/10/14 family; `control` keeps its sm/
    md/lg shape).

### 2. Fonts

- Add the `geist` package. Wire `GeistSans` + `GeistMono` via `next/font` in
  `apps/operator/src/app/layout.tsx`, exposing `--font-sans` / `--font-mono` on
  `<html>`.
- `globals.css` `body` uses `var(--font-sans)`; mono token uses `var(--font-mono)`.
- Mono is applied to numeric/technical UI (rundown indices, timecode, keycaps).
- Fallback: system UI / monospace stack if the package fails to load.

### 3. Primitive rebuild

All 13 primitives restyled against the new tokens, **public APIs unchanged**.
Additive-only API changes noted.

- **Button** — indigo `primary`; `secondary`/`ghost` on slate; red `danger`/
  `destructive`; **new additive `success` variant** (emerald, for Go/positive);
  `:focus-visible` indigo ring.
- **Input / Select / Textarea** — `--surface-2` fill, indigo focus ring +
  `--brand-subtle` glow, red ring on `invalid`.
- **Pill / StatusDot** — remap existing `PillTone`s to new state colors; **add
  console tones** `live` (red glow), `ready` (emerald), `cued` (indigo), `off`
  (additive to the `PillTone` union).
- **Panel / Modal** — new surfaces, softer elevation shadow, 10px+ radii,
  refined header dividers.
- **PageHeader / Table / Field / Stack / IconButton / Kbd / EntityList** —
  reskinned to tokens; Kbd gets the mono keycap look; Table gets subtle row
  separators + indigo selected-row treatment.

No other new components this phase.

### 4. Backward-compat sweep

- Grep the operator app for raw hex (`#0c0d10`, `#14161a`, `#ff3a3a`, `#ffb13a`,
  etc.) and for `colors.accent` usages that semantically mean "live/on-air/red".
- Preserved token names keep working; the sweep targets **hardcoded hex that
  bypasses tokens** (would clash with the new base) and any `accent`-means-red
  call site. Those are nudged onto the correct tokens (`onair`/`danger`/`brand`)
  as a targeted fix within this phase — not a broad rewrite.

---

## Testing & acceptance

A theming change is validated visually, not by unit tests.

- **Acceptance:** run the operator (`pnpm dev`) and walk every route — show mode,
  songs, shows, design, hotcards, projects, timer, scripture/stt, channels,
  account, data. Confirm: nothing unreadable, no clashing leftover hex, live/PGM
  states read clearly in red, interactive/selected states read in indigo, ready/
  positive states in emerald. Driven via the `/run` skill.
- **Regression:** `pnpm typecheck` and `pnpm test` stay green. Any existing
  primitive logic/snapshot test must pass (update snapshots only where the change
  is the intended reskin).

## Acceptance criteria (checklist)

- [ ] `globals.css` defines the full semantic token set under `:root`.
- [ ] `tokens.ts` maps all old names to new values (nothing removed) and adds the
      new names.
- [ ] Geist Sans/Mono wired via `next/font`; mono used for numeric/technical UI.
- [ ] All 13 primitives reskinned; APIs unchanged except additive `success`
      button variant and new pill tones.
- [ ] Compat sweep done; stray hardcoded hex and `accent`-means-red call sites
      corrected.
- [ ] Every route visually verified; `pnpm typecheck` and `pnpm test` green.

## Risks

- **`colors.accent` flips red → indigo.** Mitigated by the compat sweep; the
  whole point is that general accents become indigo and only true live/stop
  affordances stay red.
- **`accent2` semantic drift** (amber → warn) — low impact; used sparsely.
- **Geist package load/SSR** — mitigated by `next/font` (self-hosted) and a
  system fallback stack.
