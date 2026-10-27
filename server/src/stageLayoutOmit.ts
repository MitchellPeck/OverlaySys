import type { StageLayout } from "@overlaysys/core";

/** A copy of `obj` without `keys` (typed, no unused-variable lint workarounds). */
export function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

/** `builtIn` is a code-only flag; a stored layout must never claim it. */
export function withoutBuiltIn(layout: StageLayout): Omit<StageLayout, "builtIn"> {
  return omit(layout, ["builtIn"]);
}
