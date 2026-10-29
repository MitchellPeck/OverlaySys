"use client";

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { colors, fontSize, radius, shadow } from "./tokens";
import { tooltipLeft } from "./tooltipPlace";

const SHOW_DELAY_MS = 400;
const GAP = 6;

type ChildProps = {
  onMouseEnter?: (e: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (e: MouseEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  "aria-describedby"?: string;
};

type Props = {
  content: ReactNode;
  /** One element that accepts mouse and focus handlers (a button, a link…). */
  children: ReactElement;
  side?: "top" | "bottom";
};

type Anchor = { x: number; top: number; bottom: number };

/**
 * Shows `content` after a 400 ms hover, or at once on keyboard focus. Hides on
 * Esc, blur or mouse leave. Rendered in a portal on `document.body`.
 */
export function Tooltip({ content, children, side = "top" }: Props) {
  const id = useId();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const child = children as ReactElement<ChildProps>;
  const props = child.props;

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const hide = useCallback(() => {
    clearTimer();
    setAnchor(null);
  }, []);
  const showAt = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setAnchor({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
  };

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
    };
  }, [anchor, hide]);

  useEffect(() => clearTimer, []);

  // Measure the natural (max-content) width, then clamp inside the viewport.
  useLayoutEffect(() => {
    if (!anchor) {
      setLeft(null);
      return;
    }
    const w = tipRef.current?.offsetWidth ?? 0;
    setLeft(tooltipLeft(anchor.x, w, window.innerWidth));
  }, [anchor, content]);

  const describedBy = anchor
    ? [props["aria-describedby"], id].filter(Boolean).join(" ")
    : props["aria-describedby"];

  const trigger = cloneElement(child, {
    "aria-describedby": describedBy,
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      props.onMouseEnter?.(e);
      const el = e.currentTarget;
      clearTimer();
      timer.current = setTimeout(() => showAt(el), SHOW_DELAY_MS);
    },
    onMouseLeave: (e: MouseEvent<HTMLElement>) => {
      props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      props.onFocus?.(e);
      // Keyboard focus only; a mouse click also focuses but should not pop it.
      if (e.currentTarget.matches(":focus-visible")) {
        clearTimer();
        showAt(e.currentTarget);
      }
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      props.onBlur?.(e);
      hide();
    },
  });

  return (
    <>
      {trigger}
      {anchor && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={tipRef}
              id={id}
              role="tooltip"
              style={{
                position: "fixed",
                left: left ?? 0,
                visibility: left === null ? "hidden" : "visible",
                width: "max-content",
                top: side === "top" ? anchor.top - GAP : anchor.bottom + GAP,
                transform: side === "top" ? "translateY(-100%)" : undefined,
                zIndex: 1200, // above Menu (1100)
                pointerEvents: "none",
                maxWidth: 280,
                padding: "4px 8px",
                background: colors.surface3,
                color: colors.text,
                border: `1px solid ${colors.borderStrong}`,
                borderRadius: radius.sm,
                boxShadow: shadow.modal,
                fontSize: fontSize.xs,
                lineHeight: 1.4,
                whiteSpace: "normal",
              }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
