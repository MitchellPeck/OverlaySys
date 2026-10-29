import { useCallback, useLayoutEffect, useRef } from "react";
import { Textarea } from "@overlaysys/ui";

/**
 * Multi-line text that grows with its content. Enter adds a newline;
 * ⌘/Ctrl+Enter or leaving the field ends the edit (and its undo step).
 */
export function AutoTextarea({
  value,
  onChange,
  id,
  placeholder,
  "aria-label": ariaLabel,
  maxRows = 10,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  placeholder?: string;
  "aria-label"?: string;
  maxRows?: number;
}) {
  // Textarea doesn't forward a ref, so find it through a wrapper.
  const ref = useRef<HTMLDivElement | null>(null);
  const fit = useCallback(() => {
    const el = ref.current?.querySelector("textarea");
    if (!el) return;
    el.style.height = "auto";
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 17;
    const max = lh * maxRows + 14;
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
    el.style.overflowY = el.scrollHeight + 2 > max ? "auto" : "hidden";
  }, [maxRows]);
  useLayoutEffect(fit, [value, fit]);
  // Wrapping changes with the width (e.g. the inspector widening to 320 px), so re-fit then too.
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    let lastW = host.getBoundingClientRect().width;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? lastW;
      if (w === lastW) return; // our own height change re-fires the observer
      lastW = w;
      fit();
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [fit]);
  return (
    <div ref={ref} style={{ minWidth: 0 }}>
    <Textarea
      id={id}
      rows={1}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      style={{ resize: "none", minHeight: 24, display: "block" }}
    />
    </div>
  );
}
