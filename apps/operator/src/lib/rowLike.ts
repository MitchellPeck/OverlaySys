import type { Show } from "@overlaysys/core";

/**
 * A rundown row as the Live and show-editor code sees it: the core union, plus a
 * loose shape so unknown or newer row kinds (and slides rows reaching the
 * adapter) never break a switch with a type error.
 */
export type RowLike =
  | Show["rows"][number]
  | { kind: string; id: string; sectionId?: string; lengthSec?: number; deckId?: string };
