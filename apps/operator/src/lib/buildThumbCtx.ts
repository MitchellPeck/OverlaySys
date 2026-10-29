import type { ThumbCtx } from "./thumbClick";

/** The ctx from its parts (pure, so the field list is testable). Null with no show loaded. */
export function buildThumbCtx(p: Omit<ThumbCtx, "show"> & { show: ThumbCtx["show"] | null }): ThumbCtx | null {
  return p.show ? ({ ...p, show: p.show } as ThumbCtx) : null;
}
