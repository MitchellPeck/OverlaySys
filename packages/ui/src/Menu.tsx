"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "./Tooltip";
import { isEnabled, menuAnchorForEvent, nextMenuIndex, placeMenu, type MenuItem } from "./menuModel";
import { colors, fontFamily, fontSize, radius, shadow } from "./tokens";

export type { MenuItem } from "./menuModel";

type Anchor = { x: number; y: number } | HTMLElement;

type MenuProps = {
  items: MenuItem[];
  anchor: Anchor;
  onClose(): void;
};

const ROW_H = 28;

function anchorRect(anchor: Anchor) {
  if (typeof HTMLElement !== "undefined" && anchor instanceof HTMLElement) {
    const r = anchor.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  return { x: (anchor as { x: number }).x, y: (anchor as { y: number }).y };
}

/**
 * Portal menu. Opening focuses the first enabled item; Esc, Tab, outside
 * click, scroll and window blur close it and return focus to the opener.
 */
export function Menu({ items, anchor, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState(() => nextMenuIndex(items, -1, "Home"));

  const close = useCallback(() => {
    onClose();
    const el = opener.current;
    if (el instanceof HTMLElement && el.isConnected) el.focus();
  }, [onClose]);

  // Remember who opened us (before we steal focus), then place with real size.
  useLayoutEffect(() => {
    if (opener.current === null) opener.current = document.activeElement;
    const box = ref.current;
    if (!box) return;
    setPos(
      placeMenu(
        anchorRect(anchor),
        { w: box.offsetWidth, h: box.offsetHeight },
        { w: window.innerWidth, h: window.innerHeight },
      ),
    );
  }, [anchor, items]);

  useEffect(() => {
    if (!pos) return;
    // With nothing enabled, focus the menu itself so Esc still reaches it.
    if (active >= 0) rowRefs.current[active]?.focus();
    else ref.current?.focus();
  }, [pos, active]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", close);
    };
  }, [close]);

  const select = (item: MenuItem) => {
    if (!isEnabled(item) || "separator" in item) return;
    onClose();
    const el = opener.current;
    if (el instanceof HTMLElement && el.isConnected) el.focus();
    item.onSelect();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const handled =
      ["Escape", "Tab", "ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(e.key);
    if (!handled) return;
    // Portal events bubble through the React tree to a host Modal / app hotkeys.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape" || e.key === "Tab") close();
    else if (e.key === "Enter" || e.key === " ") {
      if (active >= 0) select(items[active]!);
    } else {
      setActive(nextMenuIndex(items, active, e.key as "ArrowDown" | "ArrowUp" | "Home" | "End"));
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        left: pos?.x ?? 0,
        top: pos?.y ?? 0,
        visibility: pos ? "visible" : "hidden",
        zIndex: 1100,
        outline: "none",
        minWidth: 180,
        maxWidth: 320,
        padding: 4,
        background: colors.surface3,
        border: `1px solid ${colors.borderStrong}`,
        borderRadius: radius.md,
        boxShadow: shadow.modal,
        fontFamily: fontFamily.sans,
        fontSize: fontSize.sm,
      }}
    >
      {items.map((item, i) => {
        if ("separator" in item) {
          return (
            <div
              key={`sep-${i}`}
              role="separator"
              style={{ height: 1, margin: "4px 0", background: colors.border }}
            />
          );
        }
        const enabled = isEnabled(item);
        const row = (
          <div
            key={item.id}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            role="menuitem"
            tabIndex={-1}
            aria-disabled={enabled ? undefined : true}
            onMouseEnter={() => enabled && setActive(i)}
            onClick={() => select(item)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: ROW_H,
              padding: "0 8px",
              borderRadius: radius.sm,
              outline: "none",
              cursor: enabled ? "pointer" : "default",
              opacity: enabled ? 1 : 0.5,
              color: item.danger ? colors.dangerText : colors.text,
              background: enabled && i === active ? colors.control : "transparent",
              whiteSpace: "nowrap",
            }}
          >
            {item.icon ? (
              <span style={{ display: "inline-flex", width: 14, flex: "none" }} aria-hidden>
                {item.icon}
              </span>
            ) : null}
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
              {item.label}
            </span>
            {item.shortcut ? (
              <span style={{ marginLeft: 16, color: colors.textMuted, fontSize: fontSize.xs }}>
                {item.shortcut}
              </span>
            ) : null}
          </div>
        );
        return typeof item.disabled === "string" ? (
          <Tooltip key={item.id} content={item.disabled} side="bottom">
            {row}
          </Tooltip>
        ) : (
          row
        );
      })}
    </div>,
    document.body,
  );
}

type Open = { items: MenuItem[]; anchor: Anchor };

/** `open(e, items)` from onContextMenu / a button click / an element; render `menu` once. */
export function useContextMenu(): {
  open(e: ReactMouseEvent | HTMLElement, items: MenuItem[]): void;
  menu: ReactNode;
} {
  const [state, setState] = useState<Open | null>(null);
  const close = useCallback(() => setState(null), []);

  const open = useCallback((e: ReactMouseEvent | HTMLElement, items: MenuItem[]) => {
    if (!("currentTarget" in e)) {
      setState({ items, anchor: e });
      return;
    }
    e.preventDefault();
    const el = e.currentTarget as HTMLElement | null;
    const useEl = menuAnchorForEvent(e) === "element" && el;
    setState({ items, anchor: useEl ? el : { x: e.clientX, y: e.clientY } });
  }, []);

  return {
    open,
    menu: state ? <Menu items={state.items} anchor={state.anchor} onClose={close} /> : null,
  };
}
