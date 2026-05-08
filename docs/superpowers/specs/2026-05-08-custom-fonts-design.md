# Custom Fonts — Design

Wire up custom font support end-to-end so text layers can use any font the user supplies (uploaded local file, web URL, or system family name).

## Background

`TemplateSchema` already declares `fonts: { family: string; src: string }[]` (template.ts:251), but no code reads or writes it. Text layers carry `fontFamily: string` (template.ts:37), currently hardcoded to `"Inter, system-ui, sans-serif"` in fixtures. The renderer applies it directly via `el.style.fontFamily = s.fontFamily` (dom.ts:57). The PropertyInspector exposes font size and weight but not family.

## Scope

Fill the gap with three small additions:

1. **Loader** — at template mount, register every entry in `template.fonts` via the FontFace API.
2. **Family picker** — a font-family input in the Text section of `PropertyInspector`, showing system fallbacks plus any fonts in `template.fonts`.
3. **"+ Add font"** popover — file upload (`.woff2/.woff/.ttf/.otf`) → data URL → push to `template.fonts` → set the current layer's `fontFamily`.

Both operator (Canvas preview, edit mode) and renderer (live output) share `mountTemplate`, so a single hook covers both.

## Out of scope

- Multiple weights/styles per family (one face per family for now; layer's `fontWeight` still works as a CSS hint).
- Editing or deleting entries from `template.fonts` post-add (later UI pass).
- Curated Google Fonts browser (paste a URL into a font entry's `src` and it works; no search UI).
- Font subsetting / size optimization. Embedded data URLs may inflate template JSON; acceptable for now since images already do this.

## Components

### 1. `packages/template-engine/src/fonts.ts` (new)

```ts
export async function ensureTemplateFonts(template: Template): Promise<void>
```

For each `{family, src}`:
- Skip if `document.fonts` already has a face matching `family`.
- `const face = new FontFace(family, `url(${src})`)`
- `document.fonts.add(face)` → `await face.load()`
- Wrap each load in try/catch — a broken font logs `console.warn` and falls through; the rest of the template still mounts.

### 2. `packages/template-engine/src/mount.ts` (modify)

`mountTemplate` becomes async-aware: call `await ensureTemplateFonts(template)` before `buildTemplateDom`, so the first painted frame uses the loaded face. Existing callers (Canvas, renderer) already accept the synchronous return shape — make `mountTemplate` continue to return synchronously, but kick off font loading and refresh font styles after fonts resolve. Two options:

- **(a)** Keep `mountTemplate` sync. Mount with fallback fonts immediately; `ensureTemplateFonts` resolves in the background, and on resolution call `document.fonts.ready` → no DOM change needed (browser re-paints text once the face is registered).
- **(b)** Make `mountTemplate` async and update both call sites.

Pick **(a)** — simpler, no API churn, and the FOUT is fine for an editor preview. The renderer will see the same brief flash on first mount; subsequent re-mounts have the face cached on `document.fonts`.

### 3. `packages/template-engine/src/index.ts` (modify)

Re-export `ensureTemplateFonts` so apps can call it independently if they want to preload fonts before showing UI.

### 4. `packages/editor-kit/src/FontInput.tsx` (new)

A controlled input combining:
- `<input list="font-options-{templateId}">` bound to `value` / `onChange`.
- `<datalist>` populated with system fallbacks (`Inter`, `system-ui`, `Arial`, `Georgia`, `Times New Roman`) plus every `family` from `template.fonts`.
- Adjacent **+** button that opens an inline popover.

Popover contents:
- File input (`accept=".woff2,.woff,.ttf,.otf"`).
- Family-name text input — auto-filled from filename (sans extension) on file pick, editable.
- "Add" button — disabled until both file and family present. On submit:
  - `FileReader.readAsDataURL(file)` → data URL.
  - Call `onAddFont({family, src: dataUrl})` (parent persists into `template.fonts`).
  - Call `onChange(family)` so the layer immediately uses the new font.
  - Close popover.

Keep the popover trivial — absolute-positioned panel, click-outside to dismiss, Escape to dismiss. No animations needed.

### 5. `packages/editor-kit/src/PropertyInspector.tsx` (modify)

In the Text section (around line 73–123), add a "Family" row above "Font size" using the new `FontInput`. Pass `template.fonts`, the current `layer.style.fontFamily`, an `onChange` that patches `layer.style.fontFamily`, and an `onAddFont` that commits a recipe pushing to `template.fonts`.

The existing Inspector receives `template` and a commit handler — no signature changes.

## Data flow

1. User clicks "+" → picks `acme-sans.woff2` → types or accepts family "Acme Sans" → Add.
2. `template.fonts` now includes `{family: "Acme Sans", src: "data:font/woff2;base64,..."}`; layer's `fontFamily` set to "Acme Sans".
3. Canvas re-mounts (existing template-change effect) → `ensureTemplateFonts` registers the face → text repaints with Acme Sans.
4. Renderer receives the updated template via the existing template-broadcast path → same flow.

## Error handling

| Case | Behavior |
|---|---|
| `face.load()` rejects (corrupt file, bad URL) | `console.warn`, continue. Text falls back to whatever the browser picks. |
| Duplicate family in `document.fonts` | Skip registration; existing face is reused. |
| Family typed manually that isn't loaded | Standard CSS fallback applies (system font). |

## Testing

- **Manual:** add a `.woff2` in operator → Canvas updates → take to renderer via the broadcast path → both match.
- **Unit:** skip the FontFace path (browser-only, hard to fake without jsdom canvas extensions). The picker UI is plain controlled-input logic — covered by interactive testing.

## Files touched

- `packages/template-engine/src/fonts.ts` *(new)*
- `packages/template-engine/src/mount.ts`
- `packages/template-engine/src/index.ts`
- `packages/editor-kit/src/FontInput.tsx` *(new)*
- `packages/editor-kit/src/PropertyInspector.tsx`
