"use client";
// TEMPORARY: P1.4's Menu / useContextMenu are not on the integration branch yet.
// Same names and shapes as contracts §2; swap the imports for "@overlaysys/ui" once P1.4 lands.
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { colors, radius } from "@overlaysys/ui";

export type MenuItem =
  | { id: string; label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean | string; shortcut?: string; onSelect(): void }
  | { separator: true };

export function useContextMenu(): { open(e: MouseEvent | HTMLElement, items: MenuItem[]): void; menu: ReactNode } {
  const [state, setState] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  useEffect(() => {
    if (!state) return;
    const close = () => setState(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
    };
  }, [state]);
  return {
    open(e, items) {
      if ("preventDefault" in e) {
        e.preventDefault();
        setState({ x: e.clientX, y: e.clientY, items });
      } else {
        const r = e.getBoundingClientRect();
        setState({ x: r.left, y: r.bottom, items });
      }
    },
    menu: state && (
      <div
        role="menu"
        onPointerDown={(e) => e.stopPropagation()}
        style={{ position: "fixed", left: state.x, top: state.y, zIndex: 1000, minWidth: 160, padding: 4, background: colors.surface2, border: `1px solid ${colors.border}`, borderRadius: radius.md }}
      >
        {state.items.map((it, i) =>
          "separator" in it ? (
            <div key={i} style={{ height: 1, background: colors.border, margin: "4px 0" }} />
          ) : (
            <button
              key={it.id}
              role="menuitem"
              disabled={!!it.disabled}
              onClick={() => {
                setState(null);
                it.onSelect();
              }}
              style={{ display: "block", width: "100%", textAlign: "left", minHeight: 24, padding: "4px 8px", background: "transparent", border: 0, color: it.danger ? colors.dangerText : colors.text, fontSize: 12, cursor: "pointer", opacity: it.disabled ? 0.5 : 1 }}
            >
              {it.label}
            </button>
          ),
        )}
      </div>
    ),
  };
}
