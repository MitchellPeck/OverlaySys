"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { colors, fontSize, radius, shadow, space } from "./tokens";
import { createToastQueue, type ToastEntry, type ToastOptions, type ToastTone } from "./toastQueue";

export type { ToastOptions, ToastTone } from "./toastQueue";

// One app-wide queue; `<ToastHost />` (mounted once in the root layout) shows it.
const queue = createToastQueue(() => Date.now());
const listeners = new Set<() => void>();
const notify = () => {
  for (const fn of [...listeners]) fn();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const EMPTY: ToastEntry[] = [];

/** Show a toast; returns its id (for `dismissToast`). */
export function toast(o: ToastOptions): string {
  const id = queue.push(o);
  notify();
  return id;
}

/** Dismiss a toast by the id `toast()` returned (no-op when already gone). */
export function dismissToast(id: string): void {
  dismiss(id);
}

export function useToast(): (o: ToastOptions) => string {
  return toast;
}

function dismiss(id: string) {
  queue.dismiss(id);
  notify();
}

const TONE: Record<ToastTone, { Icon: typeof Info; color: string }> = {
  info: { Icon: Info, color: colors.textDim },
  ok: { Icon: CircleCheck, color: colors.text },
  warn: { Icon: TriangleAlert, color: colors.warn },
  error: { Icon: CircleAlert, color: colors.dangerText },
};

/** Bottom-centre toast stack (at most 3). Errors are announced assertively. */
export function ToastHost() {
  const list = useSyncExternalStore(subscribe, queue.list, () => EMPTY);

  // Wake up at the next expiry, not on a fixed tick.
  useEffect(() => {
    if (list.length === 0) return;
    const next = Math.min(...list.map((t) => t.expiresAt));
    if (next === Infinity) return; // only persistent toasts: nothing to expire
    const timer = setTimeout(
      () => {
        queue.expire();
        notify();
      },
      Math.max(0, next - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [list]);

  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        left: "50%",
        bottom: space[5],
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: space[2],
        zIndex: 1200,
        pointerEvents: "none",
      }}
    >
      {list.map((t) => {
        const tone = TONE[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            style={{
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              gap: space[2],
              minHeight: 36,
              maxWidth: 480,
              padding: `${space[1]}px ${space[1]}px ${space[1]}px ${space[3]}px`,
              background: colors.surface2,
              border: `1px solid ${colors.border}`,
              borderRadius: radius.lg,
              boxShadow: shadow.modal,
              color: colors.text,
              fontSize: fontSize.md,
              boxSizing: "border-box",
            }}
          >
            <span aria-hidden style={{ display: "inline-flex", color: tone.color, flexShrink: 0 }}>
              <tone.Icon size={14} />
            </span>
            <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{t.message}</span>
            {t.action && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </Button>
            )}
            <IconButton aria-label="Dismiss" style={{ border: "none" }} onClick={() => dismiss(t.id)}>
              <X size={14} />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}
