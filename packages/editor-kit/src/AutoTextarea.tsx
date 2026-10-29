import { useLayoutEffect, useRef } from "react";
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
  useLayoutEffect(() => {
    const el = ref.current?.querySelector("textarea");
    if (!el) return;
    el.style.height = "auto";
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 17;
    const max = lh * maxRows + 14;
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
    el.style.overflowY = el.scrollHeight + 2 > max ? "auto" : "hidden";
  }, [value, maxRows]);
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
