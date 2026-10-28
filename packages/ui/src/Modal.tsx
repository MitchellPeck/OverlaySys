"use client";

import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { colors, fontSize, fontWeight, radius, shadow, space } from "./tokens";
import { nextTrapFocus, shouldConfirmOnEnter } from "./modalKeys";

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
  /**
   * Legacy (dialog.tsx). Keys are now always handled on the dialog itself and
   * stopped there, and a window capture-phase fallback covers focus outside
   * the dialog, so this no longer changes behaviour. Kept for API stability.
   */
  captureKeys?: boolean;
  /** Accessible name when there is no visible `title`. */
  ariaLabel?: string;
  /** "center" (default) or "top" (command-palette style, 12vh from the top). */
  placement?: "center" | "top";
  /** Stacking order of the backdrop. Default 1000. */
  zIndex?: number;
  /**
   * Dangerous confirm (delete, discard, replace): Enter only confirms when the
   * focused element is marked `data-dialog-confirm`, never from a field.
   */
  danger?: boolean;
  children: ReactNode;
  bodyStyle?: CSSProperties;
  containerStyle?: CSSProperties;
};

const SIZE_WIDTHS: Record<Size, { min: number; max: number }> = {
  sm: { min: 320, max: 480 },
  md: { min: 480, max: 720 },
  lg: { min: 640, max: 960 },
};

// Open modals, innermost last. Only the topmost one answers keys that arrive
// while focus is outside every dialog.
const openStack: symbol[] = [];

/**
 * Generic modal shell. Owns: backdrop, initial focus, Tab focus trap, focus
 * restore on close, Esc + optional Enter handlers, body-scroll lock.
 *
 * Keys the modal handles (Esc, Enter with onConfirm, Tab) are stopped on the
 * dialog element, so they never reach window-level shortcuts — Esc closing a
 * dialog must not also clear program. Focus is moved into the dialog on open
 * so that path is the normal one; a window capture-phase listener covers the
 * rare case where focus is still outside (e.g. on <body>).
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
  captureKeys: _captureKeys = false,
  ariaLabel,
  placement = "center",
  zIndex = 1000,
  danger = false,
  children,
  bodyStyle,
  containerStyle,
}: Props) {
  const lastFocused = useRef<Element | null>(null);
  const wasOpen = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const tokenRef = useRef<symbol>(Symbol("modal"));

  // Record the element to restore focus to during render: children with
  // autoFocus move focus during commit, before any effect could read it.
  if (open && !wasOpen.current && typeof document !== "undefined") {
    lastFocused.current = document.activeElement;
  }
  wasOpen.current = open;

  // Latest handlers, read by the long-lived window listener.
  const handlers = useRef({ onClose, onCancel, onConfirm, danger });
  handlers.current = { onClose, onCancel, onConfirm, danger };

  useEffect(() => {
    if (!open) return;
    const token = tokenRef.current;
    openStack.push(token);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Initial focus: keep an autoFocus'd child; otherwise the first text
    // field, otherwise the dialog itself (never a destructive button).
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      const field = dialog.querySelector<HTMLElement>(
        "[data-autofocus], input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])",
      );
      (field ?? dialog).focus();
    }
    // A button focused on open (Cancel in a confirm) gets a forced ring:
    // programmatic focus after a mouse click doesn't match :focus-visible, and
    // the operator must see which button Enter / Space will press.
    const focused = document.activeElement;
    if (dialog && focused instanceof HTMLButtonElement && dialog.contains(focused)) {
      focused.setAttribute("data-focus-visible", "");
    }

    return () => {
      const i = openStack.lastIndexOf(token);
      if (i >= 0) openStack.splice(i, 1);
      document.body.style.overflow = prevOverflow;
      const prev = lastFocused.current;
      if (prev instanceof HTMLElement && prev.isConnected) {
        prev.focus();
      }
    };
  }, [open]);

  // Fallback for keys pressed while focus fell back to <body> (e.g. after a
  // click on a non-closing backdrop). Anything focused inside the dialog — or
  // inside a portal it owns, like a popover — is handled on the dialog or by
  // that portal, so it is left alone here.
  useEffect(() => {
    if (!open) return;
    const token = tokenRef.current;
    function onKey(e: KeyboardEvent) {
      if (openStack[openStack.length - 1] !== token) return;
      if (e.target !== document.body && e.target !== document.documentElement) return;
      const dialog = dialogRef.current;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        const h = handlers.current;
        (h.onCancel ?? h.onClose)?.();
      } else if (e.key === "Enter" && handlers.current.onConfirm) {
        e.preventDefault();
        e.stopPropagation();
        // Focus is on <body>, not the confirm button: a dangerous dialog
        // never confirms from here.
        if (handlers.current.danger) return;
        handlers.current.onConfirm();
      } else if (e.key === "Tab" && dialog) {
        // Pull focus back inside.
        e.preventDefault();
        e.stopPropagation();
        dialog.focus();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open) return null;

  const widths = SIZE_WIDTHS[size];

  function onDialogKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      (onCancel ?? onClose)?.();
    } else if (e.key === "Enter" && onConfirm) {
      const target = e.target as HTMLElement;
      const focusedIsConfirm = target.hasAttribute("data-dialog-confirm");
      if (!shouldConfirmOnEnter(target.tagName, target.isContentEditable, { danger, focusedIsConfirm })) {
        // Keep a dangerous dialog's swallowed Enter from reaching window
        // shortcuts (a focused button still clicks natively).
        if (danger && target.tagName.toUpperCase() !== "BUTTON" && target.tagName.toUpperCase() !== "TEXTAREA") {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onConfirm();
    } else if (e.key === "Tab" && dialogRef.current) {
      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      const next = nextTrapFocus(focusables.length, focusables.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      if (next !== null) {
        e.preventDefault();
        if (next >= 0) focusables[next]?.focus();
      }
      e.stopPropagation();
    }
  }

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
        alignItems: placement === "top" ? "flex-start" : "center",
        justifyContent: "center",
        paddingTop: placement === "top" ? "12vh" : undefined,
        zIndex,
      }}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onDialogKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title !== undefined ? titleId : undefined}
        aria-label={title === undefined ? ariaLabel : undefined}
        tabIndex={-1}
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
          outline: "none",
          ...containerStyle,
        }}
      >
        {title !== undefined && (
          <div
            id={titleId}
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
            // Long names and paths wrap instead of widening the dialog.
            whiteSpace: "normal",
            overflowWrap: "anywhere",
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
