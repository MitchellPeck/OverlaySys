# Custom Fonts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make text layers usable with any font — uploaded `.woff2/.woff/.ttf/.otf` file, web URL, or system family name — by wiring up the existing `template.fonts: [{family, src}]` schema end-to-end.

**Architecture:** Three pieces. (1) A pure helper module in `template-engine` that registers each entry in `template.fonts` via the FontFace API at mount time, with the actual mount kept synchronous and the loader running in the background (browser repaints text once each face resolves). (2) A new `FontInput` component in `editor-kit` combining a font-family `<input list>` with a "+ Add font" popover that reads the picked file as a data URL and pushes it to `template.fonts`. (3) A small wire-up in `PropertyInspector` to drop `FontInput` into the Text section.

**Tech Stack:** TypeScript, React 19, Vitest (node env), Zod (existing), FontFace browser API, FileReader browser API.

---

## File Structure

**New:**
- `packages/template-engine/src/fonts.ts` — `ensureTemplateFonts` loader
- `packages/template-engine/src/fonts.test.ts` — pure-helper tests
- `packages/editor-kit/src/FontInput.tsx` — family picker + add-font popover
- `packages/editor-kit/src/fontUtils.ts` — pure helpers (filename → family name, dedup picker options)
- `packages/editor-kit/src/fontUtils.test.ts` — pure-helper tests

**Modified:**
- `packages/template-engine/src/mount.ts` — call `ensureTemplateFonts` during mount
- `packages/template-engine/src/index.ts` — re-export `ensureTemplateFonts`
- `packages/editor-kit/src/PropertyInspector.tsx` — add Family row to Text section

The pure helpers live in `fontUtils.ts` / `fonts.ts` so vitest's node-only test environment can cover the logic. The DOM/UI parts (`FontInput.tsx`, the FontFace registration body, `PropertyInspector` wiring) are exercised by manual verification at the end — vitest can't load the real `FontFace` constructor and the project has no jsdom configured.

---

## Task 1: Pure helper for picker option list

**Files:**
- Create: `packages/editor-kit/src/fontUtils.ts`
- Test: `packages/editor-kit/src/fontUtils.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/editor-kit/src/fontUtils.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fontFamilyFromFilename, fontPickerOptions } from "./fontUtils";

describe("fontFamilyFromFilename", () => {
  it("strips a single extension", () => {
    expect(fontFamilyFromFilename("acme-sans.woff2")).toBe("Acme Sans");
  });

  it("title-cases hyphen and underscore separators", () => {
    expect(fontFamilyFromFilename("my_cool_font.ttf")).toBe("My Cool Font");
    expect(fontFamilyFromFilename("display-bold.otf")).toBe("Display Bold");
  });

  it("preserves spaces and trims them", () => {
    expect(fontFamilyFromFilename("  Big  Display .woff")).toBe("Big Display");
  });

  it("falls back to 'Custom Font' for empty input", () => {
    expect(fontFamilyFromFilename("")).toBe("Custom Font");
    expect(fontFamilyFromFilename(".woff2")).toBe("Custom Font");
  });
});

describe("fontPickerOptions", () => {
  it("returns the system fallbacks alone when template has no fonts and current is one of them", () => {
    expect(fontPickerOptions([], "Inter")).toEqual([
      "Inter",
      "system-ui",
      "Arial",
      "Georgia",
      "Times New Roman",
    ]);
  });

  it("appends template fonts after fallbacks, deduped", () => {
    expect(
      fontPickerOptions([{ family: "Acme Sans", src: "x" }], "Acme Sans"),
    ).toEqual([
      "Inter",
      "system-ui",
      "Arial",
      "Georgia",
      "Times New Roman",
      "Acme Sans",
    ]);
  });

  it("appends the current value if it isn't already present", () => {
    expect(fontPickerOptions([], "Helvetica Neue")).toEqual([
      "Inter",
      "system-ui",
      "Arial",
      "Georgia",
      "Times New Roman",
      "Helvetica Neue",
    ]);
  });

  it("ignores empty current value", () => {
    expect(fontPickerOptions([], "")).toEqual([
      "Inter",
      "system-ui",
      "Arial",
      "Georgia",
      "Times New Roman",
    ]);
  });

  it("dedupes a template font that matches a fallback", () => {
    expect(fontPickerOptions([{ family: "Inter", src: "x" }], "Inter")).toEqual([
      "Inter",
      "system-ui",
      "Arial",
      "Georgia",
      "Times New Roman",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/editor-kit/src/fontUtils.test.ts`
Expected: FAIL — `Cannot find module './fontUtils'`.

- [ ] **Step 3: Implement the helpers**

Create `packages/editor-kit/src/fontUtils.ts`:

```ts
const SYSTEM_FALLBACKS = [
  "Inter",
  "system-ui",
  "Arial",
  "Georgia",
  "Times New Roman",
] as const;

export function fontFamilyFromFilename(name: string): string {
  // Strip extension (only the last one — covers .woff2/.woff/.ttf/.otf).
  const noExt = name.replace(/\.[^./\\]+$/, "");
  // Replace separators with spaces, collapse whitespace, trim.
  const cleaned = noExt.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Custom Font";
  // Title-case each word.
  return cleaned
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function fontPickerOptions(
  templateFonts: { family: string; src: string }[],
  currentFamily: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of SYSTEM_FALLBACKS) {
    if (!seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  for (const f of templateFonts) {
    if (!seen.has(f.family)) {
      seen.add(f.family);
      out.push(f.family);
    }
  }
  if (currentFamily && !seen.has(currentFamily)) {
    out.push(currentFamily);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/editor-kit/src/fontUtils.test.ts`
Expected: PASS, all 9 cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/editor-kit/src/fontUtils.ts packages/editor-kit/src/fontUtils.test.ts
git commit -m "feat(editor-kit): font picker helper utilities"
```

---

## Task 2: `ensureTemplateFonts` loader (skip-list helper)

**Files:**
- Create: `packages/template-engine/src/fonts.ts`
- Test: `packages/template-engine/src/fonts.test.ts`

The full loader uses `document.fonts` and `FontFace` (browser-only) and can't be unit-tested in vitest's node env. We test the small pure helper that decides whether a `{family, src}` entry needs to be (re)loaded — that's the only branching logic worth covering.

- [ ] **Step 1: Write the failing test**

Create `packages/template-engine/src/fonts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { needsLoad } from "./fonts";

describe("needsLoad", () => {
  it("returns true when no face with that family is present", () => {
    expect(needsLoad("Acme Sans", new Set())).toBe(true);
  });

  it("returns false when the family is already registered", () => {
    expect(needsLoad("Acme Sans", new Set(["Acme Sans"]))).toBe(false);
  });

  it("compares case-sensitively to match how CSS resolves family names", () => {
    expect(needsLoad("Acme Sans", new Set(["acme sans"]))).toBe(true);
  });

  it("rejects empty family names", () => {
    expect(needsLoad("", new Set())).toBe(false);
    expect(needsLoad("   ", new Set())).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/template-engine/src/fonts.test.ts`
Expected: FAIL — `Cannot find module './fonts'`.

- [ ] **Step 3: Implement `fonts.ts`**

Create `packages/template-engine/src/fonts.ts`:

```ts
import type { Template } from "@overlaysys/core";

/**
 * Pure helper extracted for testability — does this family need to be
 * registered, given the set of family names already loaded?
 */
export function needsLoad(family: string, loaded: Set<string>): boolean {
  if (!family.trim()) return false;
  return !loaded.has(family);
}

/**
 * Collect the set of font-family names already registered with the document.
 * Returns an empty set on platforms without `document.fonts` (SSR, tests).
 */
function loadedFamilies(): Set<string> {
  const out = new Set<string>();
  if (typeof document === "undefined" || !("fonts" in document)) return out;
  document.fonts.forEach((f) => out.add(f.family));
  return out;
}

/**
 * Register every entry in `template.fonts` via the FontFace API and start
 * loading them. Returns a promise that resolves when every font has either
 * loaded or failed — failures log and continue, so a single bad font never
 * blocks template mount.
 *
 * The browser repaints text automatically once a face resolves, so callers
 * can mount synchronously and let this run in the background.
 */
export async function ensureTemplateFonts(template: Template): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  if (typeof FontFace === "undefined") return;

  const loaded = loadedFamilies();
  const tasks: Promise<unknown>[] = [];

  for (const entry of template.fonts) {
    if (!needsLoad(entry.family, loaded)) continue;
    if (!entry.src) continue;
    try {
      const face = new FontFace(entry.family, `url(${entry.src})`);
      document.fonts.add(face);
      tasks.push(
        face.load().catch((err) => {
          console.warn(
            `[overlaysys] failed to load font "${entry.family}":`,
            err,
          );
        }),
      );
    } catch (err) {
      console.warn(
        `[overlaysys] could not register font "${entry.family}":`,
        err,
      );
    }
  }

  await Promise.all(tasks);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/template-engine/src/fonts.test.ts`
Expected: PASS, all 4 cases green.

- [ ] **Step 5: Run a typecheck to catch any cross-package signature mismatches**

Run: `pnpm typecheck`
Expected: PASS, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/template-engine/src/fonts.ts packages/template-engine/src/fonts.test.ts
git commit -m "feat(template-engine): ensureTemplateFonts loader"
```

---

## Task 3: Wire `ensureTemplateFonts` into `mountTemplate` + export

**Files:**
- Modify: `packages/template-engine/src/mount.ts`
- Modify: `packages/template-engine/src/index.ts`

- [ ] **Step 1: Modify `mount.ts` to kick off font loading on mount**

Open `packages/template-engine/src/mount.ts`. Add the import and a single call inside `mountTemplate` before `buildTemplateDom`. Mount stays synchronous — the promise runs in the background. The existing structure (lines 1–106) stays the same.

Add this import at the top of the file:

```ts
import { ensureTemplateFonts } from "./fonts";
```

Inside `mountTemplate`, after `const merged = withDefaults(template, initialData);` and before `const { root, nodes } = buildTemplateDom(template, merged);`, add:

```ts
  // Kick off font registration in the background. Mount stays synchronous —
  // the browser repaints text once each FontFace resolves, so the only
  // visible effect is a brief FOUT on the very first mount of a template
  // that uses a not-yet-cached font.
  void ensureTemplateFonts(template);
```

- [ ] **Step 2: Modify `index.ts` to re-export the loader**

Open `packages/template-engine/src/index.ts` and add `ensureTemplateFonts` to the exports. The file should already re-export `mountTemplate`/types — locate the existing exports and add:

```ts
export { ensureTemplateFonts } from "./fonts";
```

If `index.ts` does not exist or is empty, create the contents:

```ts
export { mountTemplate, type MountedTemplate, type MountMode } from "./mount";
export { ensureTemplateFonts } from "./fonts";
```

(Verify with `cat packages/template-engine/src/index.ts` first; only add the missing line.)

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Run all tests to confirm nothing regressed**

Run: `pnpm test`
Expected: PASS, including the new `fonts.test.ts` and `fontUtils.test.ts` from earlier tasks.

- [ ] **Step 5: Commit**

```bash
git add packages/template-engine/src/mount.ts packages/template-engine/src/index.ts
git commit -m "feat(template-engine): mount triggers ensureTemplateFonts"
```

---

## Task 4: `FontInput` component

**Files:**
- Create: `packages/editor-kit/src/FontInput.tsx`

This is a UI component — there is no jsdom configured in the repo, so we don't add a unit test. Manual verification happens in Task 6.

- [ ] **Step 1: Implement `FontInput.tsx`**

Create `packages/editor-kit/src/FontInput.tsx`:

```tsx
import { useEffect, useId, useRef, useState } from "react";
import { fontFamilyFromFilename, fontPickerOptions } from "./fontUtils";

type Props = {
  /** Currently selected font family (raw CSS string). */
  value: string;
  /** Fonts already attached to the template. */
  templateFonts: { family: string; src: string }[];
  /** Called when the user picks/types a different family. */
  onChange: (family: string) => void;
  /** Called when the user uploads a new font file. */
  onAddFont: (entry: { family: string; src: string }) => void;
};

/**
 * Family picker for text layers. Combines a free-text input bound to a
 * `<datalist>` of system fallbacks + template fonts with a "+ Add font"
 * popover that reads a picked file as a data URL.
 */
export function FontInput(props: Props) {
  const listId = useId();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [pendingFamily, setPendingFamily] = useState("");
  const [pendingSrc, setPendingSrc] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const options = fontPickerOptions(props.templateFonts, props.value);

  useEffect(() => {
    if (!popoverOpen) return;
    function onDocPointerDown(e: PointerEvent) {
      if (!popoverRef.current) return;
      if (e.target instanceof Node && popoverRef.current.contains(e.target)) {
        return;
      }
      closePopover();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePopover();
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  function closePopover() {
    setPopoverOpen(false);
    setPendingFamily("");
    setPendingSrc(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPendingSrc(reader.result);
        setPendingFamily((prev) =>
          prev ? prev : fontFamilyFromFilename(file.name),
        );
      }
    };
    reader.readAsDataURL(file);
  }

  function onSubmit() {
    if (!pendingFamily.trim() || !pendingSrc) return;
    props.onAddFont({ family: pendingFamily.trim(), src: pendingSrc });
    props.onChange(pendingFamily.trim());
    closePopover();
  }

  const canSubmit = !!pendingFamily.trim() && !!pendingSrc;

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", width: "100%", position: "relative" }}>
      <input
        list={listId}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="Inter, system-ui, sans-serif"
        style={{
          flex: 1,
          background: "var(--panel, #14161a)",
          color: "var(--text, #e9eaee)",
          border: "1px solid var(--border, #2a2e36)",
          borderRadius: 3,
          padding: "4px 6px",
          fontSize: 12,
          fontFamily: "inherit",
        }}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <button
        type="button"
        onClick={() => setPopoverOpen((v) => !v)}
        title="Add font from file"
        style={{
          width: 24,
          height: 24,
          background: "var(--panel-2, #1c1f25)",
          color: "var(--text, #e9eaee)",
          border: "1px solid var(--border, #2a2e36)",
          borderRadius: 3,
          cursor: "pointer",
          fontSize: 14,
          lineHeight: "1",
          padding: 0,
        }}
      >
        +
      </button>

      {popoverOpen && (
        <div
          ref={popoverRef}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: 10,
            background: "var(--panel, #14161a)",
            border: "1px solid var(--border, #2a2e36)",
            borderRadius: 4,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            width: 240,
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          }}
        >
          <label style={{ fontSize: 11, color: "var(--text-dim, #9099a8)" }}>Font file</label>
          <input
            ref={fileRef}
            type="file"
            accept=".woff2,.woff,.ttf,.otf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
            style={{ fontSize: 12, color: "var(--text, #e9eaee)" }}
          />
          <label style={{ fontSize: 11, color: "var(--text-dim, #9099a8)" }}>Family name</label>
          <input
            value={pendingFamily}
            onChange={(e) => setPendingFamily(e.target.value)}
            placeholder="My Font"
            style={{
              background: "var(--panel-2, #1c1f25)",
              color: "var(--text, #e9eaee)",
              border: "1px solid var(--border, #2a2e36)",
              borderRadius: 3,
              padding: "4px 6px",
              fontSize: 12,
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <button
              type="button"
              onClick={closePopover}
              style={{
                padding: "4px 8px",
                background: "transparent",
                color: "var(--text-dim, #9099a8)",
                border: "1px solid var(--border, #2a2e36)",
                borderRadius: 3,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={onSubmit}
              style={{
                padding: "4px 8px",
                background: canSubmit ? "var(--accent, #4ade80)" : "var(--panel-2, #1c1f25)",
                color: canSubmit ? "#0c0d10" : "var(--text-dim, #9099a8)",
                border: "1px solid var(--border, #2a2e36)",
                borderRadius: 3,
                fontSize: 11,
                fontWeight: 600,
                cursor: canSubmit ? "pointer" : "not-allowed",
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/editor-kit/src/FontInput.tsx
git commit -m "feat(editor-kit): FontInput component with add-font popover"
```

---

## Task 5: Wire `FontInput` into `PropertyInspector`

**Files:**
- Modify: `packages/editor-kit/src/PropertyInspector.tsx`

The Inspector renders the Text section starting around line 73. We add a Family row at the top of the section. We need access to `template` (already passed in) and a way to push to `template.fonts` — that's done via the existing commit-recipe mechanism.

- [ ] **Step 1: Confirm the existing prop shape**

Run: `grep -n "PropertyInspector\|onCommit\|onPushHistory\|template" packages/editor-kit/src/PropertyInspector.tsx | head -20`

Verify the component receives `template: Template`, `onCommit: (recipe: (d: Draft<Template>) => void) => void`, and that there is a single `patchLayer` helper used inside it for layer mutations. (The existing Color/Font size/Weight rows already use these.)

- [ ] **Step 2: Add the import for `FontInput`**

In `packages/editor-kit/src/PropertyInspector.tsx`, find the existing import block at the top and add:

```ts
import { FontInput } from "./FontInput";
```

- [ ] **Step 3: Add the Family row at the top of the Text section**

Locate the Text section — it begins with `{layer.type === "text" && (` and `<Section title="Text">` (around line 73). Add a Family row as the **first** child of `<Section title="Text">`, before the existing `<BindingControl>` for content:

```tsx
          <Row label="Family">
            <FontInput
              value={layer.style.fontFamily}
              templateFonts={template.fonts}
              onChange={(family) =>
                patchLayer({ style: { ...layer.style, fontFamily: family } } as Partial<Layer>)
              }
              onAddFont={(entry) =>
                onCommit((d) => {
                  d.fonts.push(entry);
                })
              }
            />
          </Row>
```

(Use whatever the file's existing prop name is for the commit handler. If the local variable is named differently — e.g. `props.onCommit` — match the surrounding usage in this file.)

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Run all tests**

Run: `pnpm test`
Expected: PASS — no regressions, the editor-kit/template-engine tests stay green.

- [ ] **Step 6: Commit**

```bash
git add packages/editor-kit/src/PropertyInspector.tsx
git commit -m "feat(editor-kit): font family picker in Text inspector"
```

---

## Task 6: Manual verification end-to-end

This task is the only way to verify the FontFace path actually loads a real face — vitest's node env can't.

- [ ] **Step 1: Start the dev stack**

Run: `pnpm dev`
Expected: server, operator, renderer all start (ws://localhost:4000, http://localhost:3000, http://localhost:3001).

- [ ] **Step 2: Open a template that has a text layer**

Open `http://localhost:3000` in the browser. Navigate to the Design page. Open any template containing a text layer (e.g. the lower-third fixture, if loaded).

Click the text layer on the canvas to select it.

- [ ] **Step 3: Verify the Family row is visible**

Confirm the Property Inspector shows a "Family" row at the top of the Text section, with a free-text input and a "+" button.

The dropdown (revealed when typing or focusing the input) should list at least: Inter, system-ui, Arial, Georgia, Times New Roman.

- [ ] **Step 4: Upload a custom font**

Grab any `.woff2` (or `.ttf/.otf/.woff`) file you have locally — Google Fonts download, system font copy, anything. Click the **+** button. Pick the file. The Family field should auto-fill with a title-cased version of the filename. Click **Add**.

Expected: the popover closes, the Family input value is the new family, and the text on the canvas re-paints in that font (after a brief ~50–200ms FOUT).

- [ ] **Step 5: Verify persistence**

Save the template (whatever the operator's commit/save flow is). Reload the operator page. The text layer should still render in the uploaded font, and the family entry should still be present in the template JSON's `fonts` array.

To inspect: `cat data/templates/<template-id>.json | jq '.fonts'`
Expected: an entry like `[{"family": "Acme Sans", "src": "data:font/woff2;base64,..."}]`.

- [ ] **Step 6: Verify the renderer matches**

Open `http://localhost:3001/?channel=program` (or whatever channel the operator is sending to). Push the template live via the operator. The text on the renderer should render in the same custom font.

- [ ] **Step 7: Verify a known-bad font doesn't break mount**

In the operator, manually edit the template JSON via the inspector (or by hand) to add `{family: "Bad Font", src: "data:font/woff2;base64,obviously-not-real"}` to `template.fonts`, and set a text layer's `fontFamily` to `Bad Font`. Reload the operator.

Expected: the text falls back to a system font; the browser console shows `[overlaysys] failed to load font "Bad Font": ...`; the rest of the template still mounts and renders correctly.

- [ ] **Step 8: Commit any verification fixes**

If any bug surfaces, fix in the relevant file from Tasks 2/4/5, then commit with message `fix(...)`. If everything works, no commit needed for this task.

---

## Self-Review Notes

- **Spec coverage:** Loader → Task 2/3. Family picker → Task 4/5. Add-font popover → Task 4. System fallback list → Task 1. Skip-already-registered → Task 2. Per-font error handling → Task 2. Manual verification end-to-end → Task 6. ✓
- **Out-of-scope items honored:** No edit/delete UI for `template.fonts`; no multi-weight-per-family tooling; no Google Fonts curated browser. ✓
- **Type consistency:** `templateFonts` → `template.fonts` shape (`{family, src}`) is consistent across `FontInput` props, `PropertyInspector` wiring, and `ensureTemplateFonts`. ✓
- **Placeholder scan:** No "TBD"/"handle edge cases" — every step has concrete code or commands. ✓
