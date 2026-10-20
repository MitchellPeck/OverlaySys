"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { colors, radius, shadow } from "@overlaysys/ui";
import { POPOVER_W, popoverPosition } from "@/lib/popoverPosition";

/**
 * Portal popover hung from an anchor element. Esc is swallowed in the capture
 * phase so the console's global Esc ("clear program") never fires while a
 * popover is open. Every other key pressed inside the popover is stopped in
 * the document bubble phase (after React's handlers, before the window-level
 * shortcuts), so Enter/Space on a focused button activate that button rather
 * than cueing/taking the rundown selection. No preventDefault, so native
 * button activation still happens.
 */
export function AnchoredPopover({
  anchorEl,
  onClose,
  width = POPOVER_W,
  children,
}: {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchorEl) return;
    const place = () => {
      const r = anchorEl.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 0;
      setPos(popoverPosition(r, h, { width: window.innerWidth, height: window.innerHeight }, width));
    };
    place();
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorEl, width]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorEl?.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    }
    function onKeyInside(e: KeyboardEvent) {
      if (ref.current?.contains(e.target as Node)) e.stopPropagation();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keydown", onKeyInside);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keydown", onKeyInside);
    };
  }, [anchorEl, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      style={{
        position: "fixed",
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width,
        maxHeight: "80vh",
        overflow: "auto",
        zIndex: 1500,
        background: colors.surface,
        border: `1px solid ${colors.borderStrong}`,
        borderRadius: radius.lg,
        boxShadow: shadow.modal,
        padding: 8,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
