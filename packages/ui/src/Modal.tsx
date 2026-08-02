"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { colors, fontSize, fontWeight, radius, shadow, space } from "./tokens";

type Size = "sm" | "md" | "lg";

type Props = {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  size?: Size;
  /** Footer slot — rendered with right-aligned flex layout. */
  footer?: ReactNode;
  /** Called when Enter is pressed inside the modal. */
  onConfirm?: () => void;
  /** Called when Escape is pressed (in addition to onClose). Defaults to onClose. */
  onCancel?: () => void;
  /** Click backdrop to close. Default true. */
  closeOnBackdrop?: boolean;
  /** Capture-phase keydown listener (matches dialog.tsx legacy behavior). */
  captureKeys?: boolean;
  children: ReactNode;
  bodyStyle?: CSSProperties;
  containerStyle?: CSSProperties;
};

const SIZE_WIDTHS: Record<Size, { min: number; max: number }> = {
  sm: { min: 320, max: 480 },
  md: { min: 480, max: 720 },
  lg: { min: 640, max: 960 },
};

/**
 * Generic modal shell. Owns: backdrop, focus restore on close, Esc + optional
 * Enter handlers, body-scroll lock. Replaces the inline DialogShell in
 * apps/operator/src/lib/dialog.tsx and the per-modal wrappers in
 * apps/operator/src/app/songs/{ImportFromFileModal,PasteLyricsModal}.tsx.
 */
export function Modal({
  open,
  onClose,
  title,
  size = "sm",
  footer,
  onConfirm,
  onCancel,
  closeOnBackdrop = true,
  captureKeys = false,
  children,
  bodyStyle,
  containerStyle,
}: Props) {
  const lastFocused = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      const prev = lastFocused.current;
      if (prev instanceof HTMLElement) {
        prev.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        (onCancel ?? onClose)?.();
      } else if (e.key === "Enter" && onConfirm) {
        // Don't fire on Enter inside a textarea or contentEditable; users
        // expect those to insert a newline.
        const ae = document.activeElement as HTMLElement | null;
        if (ae) {
          const tag = ae.tagName;
          if (tag === "TEXTAREA" || ae.isContentEditable) return;
          if (tag === "BUTTON") return;
        }
        e.preventDefault();
        onConfirm();
      }
    }
    window.addEventListener("keydown", onKey, captureKeys);
    return () => window.removeEventListener("keydown", onKey, captureKeys);
  }, [open, onCancel, onClose, onConfirm, captureKeys]);

  if (!open) return null;

  const widths = SIZE_WIDTHS[size];

  // Renders IN PLACE — deliberately not through createPortal. A consumer
  // (apps/operator/src/app/pco/page.tsx's SongDraftModal) detects a nested
  // confirm dialog by querying its own subtree for `[role="dialog"]`, and uses
  // that to decide whether an Escape was meant for the confirm or for itself.
  // Portalling this component would move nested modals out of that subtree, the
  // query would silently find nothing, and one Escape aimed at a confirm would
  // also discard the operator's entire song draft. Fix that consumer first.
  return (
    <div
      onClick={closeOnBackdrop ? () => onClose?.() : undefined}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          background: colors.panel,
          border: `1px solid ${colors.border}`,
          borderRadius: radius.lg,
          minWidth: widths.min,
          maxWidth: widths.max,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: shadow.modal,
          ...containerStyle,
        }}
      >
        {title !== undefined && (
          <div
            style={{
              padding: `${space[3]}px ${space[4]}px ${space[2]}px`,
              fontSize: fontSize.base,
              fontWeight: fontWeight.semibold,
              color: colors.text,
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            {title}
          </div>
        )}
        <div
          style={{
            padding: space[4],
            fontSize: fontSize.md,
            color: colors.text,
            lineHeight: 1.5,
            overflow: "auto",
            flex: 1,
            ...bodyStyle,
          }}
        >
          {children}
        </div>
        {footer && (
          <div
            style={{
              display: "flex",
              gap: space[2],
              justifyContent: "flex-end",
              padding: `${space[2]}px ${space[4]}px ${space[3]}px`,
              borderTop: `1px solid ${colors.border}`,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
