# Group Click-to-Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the editor canvas treat groups as selectable units. A click on any descendant of a group selects the **group**; a double-click "enters" the group so subsequent clicks select its children. Mirrors Figma / Sketch.

**Architecture:** Extract the selection-picking algorithm into a pure function `pickGroupSelection(chain, enteredGroupId)` so it can be unit-tested without a DOM. Refactor Canvas's `onStagePointerDown` to (1) build a chain of `{id, isGroup}` ancestors via the existing `data-layer-id` / `data-layer-type` attributes, (2) call the pure picker, (3) detect double-clicks via a `lastClickRef`, (4) maintain `enteredGroupId` Canvas-local state. Add an Escape key handler to step out one level.

**Tech Stack:** TypeScript, React 19, Vitest (node env). No DOM mocking — pure-function tests cover the algorithm; the wiring into Canvas is exercised by manual verification.

---

## File Structure

**New:**
- `packages/editor-kit/src/groupSelection.ts` — pure helpers (`pickGroupSelection`, `isDoubleClick`)
- `packages/editor-kit/src/groupSelection.test.ts` — unit tests for the helpers

**Modified:**
- `packages/editor-kit/src/Canvas.tsx` — refactor `onStagePointerDown`, add `enteredGroupId` state, add Escape handler

The existing `data-layer-id` and `data-layer-type` attributes (already set by `template-engine/src/dom.ts:138, 251`) provide everything the chain walker needs — no template-engine or schema change.

---

## Task 1: Pure helpers — chain picker + double-click predicate

**Files:**
- Create: `packages/editor-kit/src/groupSelection.ts`
- Test: `packages/editor-kit/src/groupSelection.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/editor-kit/src/groupSelection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isDoubleClick, pickGroupSelection } from "./groupSelection";

const G = (id: string) => ({ id, isGroup: true });
const L = (id: string) => ({ id, isGroup: false });

describe("pickGroupSelection", () => {
  it("returns BACKGROUND when chain is empty", () => {
    expect(pickGroupSelection([], null)).toEqual({ kind: "background" });
  });

  it("with no entered group, picks the outermost group in the chain", () => {
    // chain = innermost..outermost; click on a leaf inside group1 inside group2
    const chain = [L("leaf"), G("inner"), G("outer")];
    expect(pickGroupSelection(chain, null)).toEqual({ kind: "select", id: "outer" });
  });

  it("with no entered group and no groups in chain, picks the leaf", () => {
    const chain = [L("leaf")];
    expect(pickGroupSelection(chain, null)).toEqual({ kind: "select", id: "leaf" });
  });

  it("when the entered group is in the chain, picks the outermost group inside it", () => {
    // entered = "outer"; chain has outer at the top, inner one level down, leaf at bottom
    const chain = [L("leaf"), G("inner"), G("outer")];
    expect(pickGroupSelection(chain, "outer")).toEqual({ kind: "select", id: "inner" });
  });

  it("when the entered group is in the chain and slice has only a leaf, picks the leaf", () => {
    const chain = [L("leaf"), G("outer")];
    expect(pickGroupSelection(chain, "outer")).toEqual({ kind: "select", id: "leaf" });
  });

  it("when the click landed on the entered group itself with no descendant, exits", () => {
    // Click on the group's own padding/chrome — chain has only the group.
    const chain = [G("outer")];
    expect(pickGroupSelection(chain, "outer")).toEqual({ kind: "exit" });
  });

  it("when entered group is set but not in chain, falls through to outermost-group logic", () => {
    // User entered group "outer", then clicks somewhere outside it.
    const chain = [L("other-leaf"), G("other-group")];
    expect(pickGroupSelection(chain, "outer")).toEqual({
      kind: "select",
      id: "other-group",
    });
  });

  it("supports nested groups one level deep with no entered group", () => {
    // chain: leaf -> innerGroup -> middleGroup -> outerGroup
    const chain = [L("leaf"), G("innerG"), G("middleG"), G("outerG")];
    expect(pickGroupSelection(chain, null)).toEqual({ kind: "select", id: "outerG" });
  });

  it("supports nested groups when middle is entered", () => {
    const chain = [L("leaf"), G("innerG"), G("middleG"), G("outerG")];
    expect(pickGroupSelection(chain, "middleG")).toEqual({
      kind: "select",
      id: "innerG",
    });
  });
});

describe("isDoubleClick", () => {
  it("returns true when within threshold and groupId in chain", () => {
    const chain = [L("leaf"), G("g1")];
    expect(
      isDoubleClick(
        { time: 1000, groupId: "g1" },
        1200,
        chain,
        300,
      ),
    ).toBe(true);
  });

  it("returns false when over threshold", () => {
    const chain = [L("leaf"), G("g1")];
    expect(
      isDoubleClick({ time: 1000, groupId: "g1" }, 1500, chain, 300),
    ).toBe(false);
  });

  it("returns false when last groupId is null", () => {
    const chain = [L("leaf"), G("g1")];
    expect(
      isDoubleClick({ time: 1000, groupId: null }, 1100, chain, 300),
    ).toBe(false);
  });

  it("returns false when last groupId not in current chain", () => {
    const chain = [L("leaf"), G("other")];
    expect(
      isDoubleClick({ time: 1000, groupId: "g1" }, 1100, chain, 300),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test packages/editor-kit/src/groupSelection.test.ts`
Expected: FAIL — `Cannot find module './groupSelection'`.

- [ ] **Step 3: Implement the helpers**

Create `packages/editor-kit/src/groupSelection.ts`:

```ts
export type ChainEntry = { id: string; isGroup: boolean };

/**
 * Result of resolving a click: either select a specific layer, exit the
 * currently-entered group, or fall through to background-clear.
 */
export type SelectionResult =
  | { kind: "select"; id: string }
  | { kind: "exit" }
  | { kind: "background" };

/**
 * Pick the layer that should be selected by a click, given the chain of
 * ancestors (innermost → outermost) and the currently-entered group (if any).
 *
 * Rules:
 *   - Empty chain → background.
 *   - If `enteredGroupId` is in the chain, restrict to entries strictly
 *     inside it (slice up to but not including the entered group).
 *       - If that slice is empty, the click landed on the entered group's
 *         own chrome → exit.
 *       - Otherwise pick the outermost group in the slice; fall back to
 *         the leaf if there are no groups.
 *   - Else pick the outermost group in the chain; fall back to the leaf.
 */
export function pickGroupSelection(
  chain: ChainEntry[],
  enteredGroupId: string | null,
): SelectionResult {
  if (chain.length === 0) return { kind: "background" };

  const enteredIdx = enteredGroupId
    ? chain.findIndex((c) => c.id === enteredGroupId)
    : -1;

  const slice = enteredIdx >= 0 ? chain.slice(0, enteredIdx) : chain;

  if (enteredIdx >= 0 && slice.length === 0) {
    return { kind: "exit" };
  }

  // Walk slice outermost → innermost looking for a group.
  for (let i = slice.length - 1; i >= 0; i--) {
    const entry = slice[i];
    if (entry && entry.isGroup) return { kind: "select", id: entry.id };
  }

  // No group in slice — pick the leaf (innermost entry).
  const leaf = slice[0];
  if (!leaf) return { kind: "background" };
  return { kind: "select", id: leaf.id };
}

/**
 * Tracks the previous click for double-click detection. `groupId === null`
 * means the previous click did not land on a group, so a follow-up click
 * cannot count as a "double-click on a group".
 */
export type LastClick = { time: number; groupId: string | null };

/**
 * Was this pointerdown a double-click on the previously-clicked group?
 *
 * True iff:
 *   - `last.groupId` is non-null,
 *   - the new click happened within `thresholdMs` of `last.time`,
 *   - the chain still contains `last.groupId` (i.e. we're clicking inside
 *     the same group that was just selected).
 */
export function isDoubleClick(
  last: LastClick,
  now: number,
  chain: ChainEntry[],
  thresholdMs: number,
): boolean {
  if (!last.groupId) return false;
  if (now - last.time >= thresholdMs) return false;
  return chain.some((c) => c.id === last.groupId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test packages/editor-kit/src/groupSelection.test.ts`
Expected: PASS, all 13 cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/editor-kit/src/groupSelection.ts packages/editor-kit/src/groupSelection.test.ts
git commit -m "feat(editor-kit): pure helpers for group-aware canvas selection"
```

---

## Task 2: Wire helpers into `Canvas.tsx`

**Files:**
- Modify: `packages/editor-kit/src/Canvas.tsx`

This rewrites the chain walker, replaces the bottom of `onStagePointerDown`, adds `enteredGroupId` state, adds a `lastClickRef`, and adds a chain-extraction helper. The pan-mode short-circuit, drag mechanics, and selection overlay all stay as-is.

- [ ] **Step 1: Add imports for the new helpers**

Open `packages/editor-kit/src/Canvas.tsx`. Add to the existing imports near the top:

```ts
import {
  isDoubleClick,
  pickGroupSelection,
  type ChainEntry,
  type LastClick,
} from "./groupSelection";
```

- [ ] **Step 2: Add Canvas-local state for the entered group and the last-click ref**

Inside `Canvas(props)`, alongside the existing `dragRef`, `panDragRef`, `scaleRef`, `pan`, `spaceHeld`, etc., add:

```ts
  const [enteredGroupId, setEnteredGroupId] = useState<string | null>(null);
  const lastClickRef = useRef<LastClick>({ time: 0, groupId: null });
```

The `useState` and `useRef` are already imported at the top of the file — no extra imports needed.

- [ ] **Step 3: Reset `enteredGroupId` when the template structurally changes**

Find the existing `useEffect` that re-mounts on template change (around line 90: `// Re-mount on template structure change.`). Right after that effect's body — as a separate effect or appended into it — add:

```ts
  useEffect(() => {
    // Switching templates invalidates any "entered group" selection state.
    setEnteredGroupId(null);
    lastClickRef.current = { time: 0, groupId: null };
  }, [props.template]);
```

(Keep this as a distinct effect rather than inlining into the mount effect — clearer responsibility.)

- [ ] **Step 4: Add a chain-extraction helper inside the component**

Above `function onStagePointerDown(e: React.PointerEvent)`, add a small helper that walks up the DOM:

```ts
  function buildLayerChain(target: EventTarget | null): ChainEntry[] {
    const chain: ChainEntry[] = [];
    let el = target as HTMLElement | null;
    while (el && el !== stageRef.current) {
      const id = el.dataset["layerId"];
      if (id) {
        chain.push({ id, isGroup: el.dataset["layerType"] === "group" });
      }
      el = el.parentElement;
    }
    return chain;
  }
```

- [ ] **Step 5: Rewrite `onStagePointerDown`**

Replace the existing body of `onStagePointerDown` (currently at Canvas.tsx:312–333) with this version. The pan branch stays the same; only the layer-selection branch changes:

```ts
  function onStagePointerDown(e: React.PointerEvent) {
    if (shouldPan(e)) {
      e.preventDefault();
      e.stopPropagation();
      beginPan(stageRef.current!, e);
      return;
    }

    const chain = buildLayerChain(e.target);
    const now = performance.now();
    const last = lastClickRef.current;

    // Double-click detection: a second click within 300ms on the previously
    // selected group "enters" that group.
    if (isDoubleClick(last, now, chain, 300)) {
      const newEntered = last.groupId!;
      setEnteredGroupId(newEntered);
      const inner = pickGroupSelection(chain, newEntered);
      if (inner.kind === "select") {
        e.stopPropagation();
        props.onSelectLayer(inner.id);
        beginLayerDrag(stageRef.current!, "move", inner.id, e);
      } else if (inner.kind === "exit") {
        // Click landed on the group itself even after entering — clear.
        setEnteredGroupId(null);
        props.onSelectLayer(null);
      } else {
        props.onSelectLayer(null);
      }
      lastClickRef.current = { time: 0, groupId: null };
      return;
    }

    const result = pickGroupSelection(chain, enteredGroupId);

    if (result.kind === "background") {
      setEnteredGroupId(null);
      props.onSelectLayer(null);
      lastClickRef.current = { time: 0, groupId: null };
      return;
    }

    if (result.kind === "exit") {
      setEnteredGroupId(null);
      props.onSelectLayer(null);
      lastClickRef.current = { time: 0, groupId: null };
      return;
    }

    e.stopPropagation();
    props.onSelectLayer(result.id);
    beginLayerDrag(stageRef.current!, "move", result.id, e);

    const pickedIsGroup = chain.find((c) => c.id === result.id)?.isGroup === true;
    lastClickRef.current = {
      time: now,
      groupId: pickedIsGroup ? result.id : null,
    };
  }
```

- [ ] **Step 6: Add an Escape handler that exits one group level**

There's already a `useEffect` listening for the Space key (around lines 57–87). Add a sibling effect immediately after it — keep it separate so the Space-key logic stays narrowly scoped:

```ts
  // Escape exits one level of group entry. Selection stays put — that
  // matches the "step out" intuition without surprising the user by
  // also clearing what they had selected.
  useEffect(() => {
    function isEditable(): boolean {
      const ae = document.activeElement as HTMLElement | null;
      if (!ae) return false;
      const tag = ae.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        ae.isContentEditable
      );
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (isEditable()) return;
      setEnteredGroupId(null);
      lastClickRef.current = { time: 0, groupId: null };
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
```

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: PASS — no TS errors. If `EventTarget | null` causes a typing issue, narrow with `e.target as HTMLElement | null` at the call site instead.

- [ ] **Step 8: Run all tests**

Run: `pnpm test`
Expected: PASS — `groupSelection.test.ts` cases stay green and nothing else regresses.

- [ ] **Step 9: Commit**

```bash
git add packages/editor-kit/src/Canvas.tsx
git commit -m "feat(editor-kit): canvas click selects groups; dbl-click enters"
```

---

## Task 3: Manual verification

The pure-function tests cover the algorithm, but the integration with real DOM events / `data-layer-*` attributes / drag mechanics needs a click-in-the-browser pass.

- [ ] **Step 1: Start the dev stack**

Run: `pnpm dev`
Expected: server, operator, renderer all start.

- [ ] **Step 2: Open a template with a group**

Open `http://localhost:3000`, navigate to Design, open the lower-third fixture (or any template that contains a `group` layer with multiple children). The lower-third has a `lt-group` containing the bar, plate, name, and title text layers.

- [ ] **Step 3: Single-click a child of the group**

Click on the "Name" or "Title" text on the canvas.
Expected: the **group** is selected (selection rectangle wraps all four children, not just the text). The Property Inspector shows the Group fields, not the text fields.

- [ ] **Step 4: Double-click the same area**

Double-click on the "Name" text.
Expected: the inner text layer is selected (selection rectangle hugs just the text). Property Inspector shows text-style fields. Subsequent single-clicks on other children of the group select those children directly.

- [ ] **Step 5: Click on a *different* element outside the group (background)**

Click on the empty canvas background.
Expected: selection clears AND `enteredGroupId` resets — verify by clicking inside the group again: the **group** should be selected again, not the inner child.

- [ ] **Step 6: Press Escape while inside a group**

Re-enter the group with double-click, select a child, press `Escape`.
Expected: child stays selected, but a subsequent click inside the group selects the **group** again (proves `enteredGroupId` cleared even though selection didn't).

- [ ] **Step 7: Verify dragging still works**

With the group selected (after a single click on a child), drag — the whole group moves together. After double-clicking to enter and selecting a child, drag — only the child moves.

- [ ] **Step 8: Verify nested groups (if a fixture exists)**

If you can manually nest groups (or via a hand-edited template JSON), confirm:
- First click on the deepest leaf → outermost group selects.
- Double-click that → outermost is "entered"; next click on leaf → middle group selects.
- Double-click again → middle is "entered"; next click → leaf selects.

If no nested-group fixture exists, skip this step.

- [ ] **Step 9: Commit any verification fixes**

If any bug surfaces, fix in `Canvas.tsx` or `groupSelection.ts`, re-run `pnpm test`, and commit with a `fix(...)` message. If everything works, no commit.

---

## Self-Review Notes

- **Spec coverage:** Single-click selects outermost group → Task 1 (`pickGroupSelection` rule "no entered group → outermost group") + Task 2 wiring. Double-click enters group → Task 1 (`isDoubleClick`) + Task 2 (the `if (isDoubleClick(...))` branch). Click on background exits and clears → Task 2 (`background` and `exit` branches). Escape key exits one level → Task 2 Step 6. Nested groups one level at a time → Task 1 cases "supports nested groups when middle is entered" + Task 2 manual verification Step 8. ✓
- **Type consistency:** `ChainEntry`, `SelectionResult`, `LastClick` defined once in `groupSelection.ts` and imported into `Canvas.tsx`. ✓
- **Placeholder scan:** No "TBD"/"handle edge cases" — every step has concrete code or commands. ✓
- **No DOM breakage:** `data-layer-id` and `data-layer-type` are already set by `template-engine/src/dom.ts` (lines 138, 251) — the chain walker only reads what's already there. ✓
