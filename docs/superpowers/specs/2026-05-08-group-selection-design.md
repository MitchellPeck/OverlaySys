# Group Click-to-Select — Design

Make the editor canvas treat groups as selectable units: a click on any descendant of a group selects the group; a double-click "enters" the group so subsequent clicks select its children. Mirrors Figma / Sketch behavior.

## Background

`Canvas.tsx:312` walks up from the pointerdown target and selects the **first** layer id it encounters — always the deepest leaf. Groups are never selected by clicking inside them; only the LayerTree side panel can select them. With nested layers (lower-third group containing bar, plate, name, title), this is the wrong default.

## Scope

Add a single piece of Canvas-local state, `enteredGroupId: string | null`, and rewrite the pointerdown selection algorithm to pick the right ancestor based on it. No schema, no DOM, no template-engine changes — purely interaction logic in `Canvas.tsx`.

## Behavior

| User gesture | Result |
|---|---|
| Click inside a group, no group entered | Select the **outermost** group containing the click. |
| Click inside the entered group | Select the outermost group/leaf in the slice **below** the entered group. |
| Click on the entered group's own chrome (above all children) | Exit the group (clear entered + selection). |
| Click on background | Exit any entered group + clear selection. |
| Double-click on a selected group | Enter it. The pointerdown that completes the double-click also selects+drags whatever was clicked, in one gesture. |
| Press `Escape` | Exit one level (set `enteredGroupId` to null). |

Nested groups: double-click descends one level at a time. `enteredGroupId` only tracks the deepest entered group; the outer ancestors are still treated as "outside" the active group, which is what we want — clicks above the entered subtree pop you back out.

## Algorithm

### Chain extraction

Walk up from `e.target`, collecting `{id, isGroup}` for every element with `dataset.layerId`. Result is innermost → outermost. Already 90% present in the existing handler.

### Pick selection

```
chain = walkUp(target)            // innermost..outermost
if chain.empty: return BACKGROUND

enteredIdx = chain.findIndex(c => c.id === enteredGroupId)
slice = enteredIdx >= 0 ? chain.slice(0, enteredIdx) : chain

if slice.empty:
  // click landed on the entered group's own element with no descendant under cursor
  return EXIT_AND_CLEAR

// outermost group in slice
for i from slice.length-1 down to 0:
  if slice[i].isGroup: return slice[i].id

// no groups → leaf
return slice[0].id
```

### Double-click detection

A `lastClickRef` ref holds `{time: number, groupId: string | null}`. On each pointerdown:

1. Compute `chain` and `pickedId` as above.
2. If `now - lastClickRef.time < 300` AND `lastClickRef.groupId` is in `chain` → treat as double-click on that group:
   - `setEnteredGroupId(lastClickRef.groupId)`.
   - Re-run the algorithm with the new entered state to pick the correct child.
   - Reset `lastClickRef`.
3. Else single-click:
   - Apply selection / drag normally.
   - If the picked item is a group, store `{time: now, groupId: pickedId}` in `lastClickRef`. Else store nulls (no double-click target).

300 ms threshold matches the OS double-click default closely enough; can be tweaked later if it feels off.

### Escape key

Add a `keydown` listener (alongside the existing space-key listener) that, when `Escape` is pressed and the focus isn't in an editable, sets `enteredGroupId` to null. Keep selection — that matches the "step out one level" intuition.

### Visual cue (optional, kept minimal)

When a group is entered, draw the group's bounding box with a dim secondary outline so the user knows they're "inside" it. Re-uses `recomputeSelRect` logic on `enteredGroupId`. Add only if it lands easily — not blocking.

## Existing dataset attributes

`buildLayer` (dom.ts:138, 251) already sets `data-layer-id` and `data-layer-type` on every node, including `data-layer-type="group"`. The chain walker uses these directly — no DOM changes required.

## Edge cases

- **Click on a resize handle of a selected group's child.** The handle is rendered by `SelectionOverlay` outside the layer DOM and has its own pointerdown handler — unaffected by this logic.
- **`onCommit`/`onLive` recipes finding layers.** `findLayerInDraft` already recurses through groups (Canvas.tsx:451). Selecting a group id and dragging it moves the group's transform, which is what we want.
- **Drag-to-move during the pointerdown that begins a double-click.** The first click already started a drag on the group; the second click within 300 ms is treated as a double-click — re-target to the inner item *before* `beginLayerDrag` runs in the second pointerdown handler. Net effect: one tiny "selected group, then jumped to child" feel, but no drag-confusion since the second pointerdown supersedes the first's selection state cleanly.

## Files touched

- `packages/editor-kit/src/Canvas.tsx`
