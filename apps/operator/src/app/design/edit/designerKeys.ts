/** Pure key-intent helpers for the template designer. */

export type SpaceInput = { phase: "down" | "up"; repeat: boolean; panned: boolean; typing: boolean };

/**
 * Space is both the pan modifier (hold + drag) and the play/pause toggle (tap).
 * Keydown only arms; keyup toggles play unless a pan happened while held.
 */
export function spaceAction(i: SpaceInput): "none" | "arm" | "toggle-play" {
  if (i.typing) return "none";
  if (i.phase === "down") return i.repeat ? "none" : "arm";
  return i.panned ? "none" : "toggle-play";
}

// Defined in editor-kit so Canvas (a package) can use it too.
export { escAction } from "@overlaysys/editor-kit";
