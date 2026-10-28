import { useRef } from "react";

type Recipe<T> = (d: T) => void;

/** Inputs whose every keystroke / drag tick fires change: typing, spinners, color pickers, sliders. */
export function isContinuousInput(el: EventTarget | null): boolean {
  const e = el as { tagName?: string; type?: string } | null;
  if (!e || typeof e.tagName !== "string") return false;
  const tag = e.tagName.toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  const type = (e.type ?? "text").toLowerCase();
  return type === "text" || type === "number" || type === "color" || type === "range" || type === "search" || type === "";
}

/**
 * Pure state machine behind useEditCoalescer: one undo step per focused
 * edit. The first change typed into a field commits (pushing history); the
 * rest, until focus moves, apply live onto that same step. Discrete controls
 * (checkboxes, selects, buttons) always commit.
 */
export function createEditCoalescer<T>(onCommit: (r: Recipe<T>) => void, onLive?: (r: Recipe<T>) => void) {
  let committed = false;
  let continuous = false;
  return {
    /** Focus entered or left a control: the next edit starts a new step. */
    reset() {
      committed = false;
    },
    /** The change event about to run came from `target`. */
    noteChange(target: EventTarget | null) {
      continuous = isContinuousInput(target);
    },
    /** A click (button) — never coalesced. */
    noteClick() {
      continuous = false;
    },
    run(recipe: Recipe<T>) {
      if (continuous && committed && onLive) onLive(recipe);
      else {
        onCommit(recipe);
        committed = continuous;
      }
      continuous = false;
    },
  };
}

/**
 * Spread `handlers` on a panel's root element and route its edits through
 * `commit`: each field edit becomes a single undo step instead of one per
 * keystroke, while the canvas still updates live as you type.
 */
export function useEditCoalescer<T>(onCommit: (r: Recipe<T>) => void, onLive?: (r: Recipe<T>) => void) {
  const ref = useRef<ReturnType<typeof createEditCoalescer<T>> | null>(null);
  const fns = useRef({ onCommit, onLive });
  fns.current = { onCommit, onLive };
  if (!ref.current) {
    ref.current = createEditCoalescer<T>(
      (r) => fns.current.onCommit(r),
      (r) => (fns.current.onLive ?? fns.current.onCommit)(r),
    );
  }
  const c = ref.current;
  return {
    commit: c.run,
    handlers: {
      onFocusCapture: () => c.reset(),
      onBlurCapture: () => c.reset(),
      onChangeCapture: (e: React.SyntheticEvent) => c.noteChange(e.target),
      onClickCapture: () => c.noteClick(),
    },
  };
}
