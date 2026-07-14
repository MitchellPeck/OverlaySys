"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Scrollable body region rendered inside the AppShell's content slot. Optional
 * `padding` (defaults to `24`) and `maxWidth` so the common "centered list"
 * pattern is one prop instead of a nested div per page. Pass `style={{ height:
 * "100%" }}` when the body should scroll inside the shell's `overflow: hidden`
 * slot rather than being clipped.
 *
 * (The former `PageShell` wrapper was removed once the two-tier AppShell took
 * over global page chrome; only this body helper remains.)
 */
export function PageBody({
  children,
  padding = 24,
  maxWidth,
  style,
}: {
  children: ReactNode;
  padding?: number | string;
  maxWidth?: number | string;
  style?: CSSProperties;
}) {
  return (
    <div style={{ overflow: "auto", padding, ...style }}>
      {maxWidth ? (
        <div style={{ maxWidth, margin: "0 auto" }}>{children}</div>
      ) : (
        children
      )}
    </div>
  );
}
