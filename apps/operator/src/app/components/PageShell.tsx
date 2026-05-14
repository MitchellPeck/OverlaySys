"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Standard page chrome that fits inside the viewport without spilling.
 *
 * The pattern: a fixed-position grid filling the viewport, with an `auto`
 * row for the header and a `minmax(0, 1fr)` row for the body. The body has
 * its own `overflow: auto` so scrolling happens *inside* the page instead
 * of the browser window itself. Keeps the AppHeader pinned at the top no
 * matter how tall the content is.
 *
 * Pages render their AppHeader as the first child and put their main
 * content as the second child:
 *
 *   <PageShell>
 *     <AppHeader title="…" actions={…} />
 *     <PageBody>…content…</PageBody>
 *   </PageShell>
 *
 * Modals / dialog overlays can sit as a third sibling — they use their own
 * `position: fixed` so DOM order doesn't affect their layering.
 */
export function PageShell({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </main>
  );
}

/**
 * Scrollable body region inside a PageShell. Optional `padding` (defaults to
 * `24`) and `maxWidth` so the common "centered list" pattern is one prop
 * instead of a nested div per page.
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
