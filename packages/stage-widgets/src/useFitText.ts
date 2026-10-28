import { useLayoutEffect, useRef, useState } from "react";
import { searchFontSize } from "./fitText";

const MIN_FONT = 12;

/** Shrinks the element's font from maxSize until it no longer overflows. Re-fits when `dep` changes. */
export function useFitText<T extends HTMLElement>(maxSize: number, enabled: boolean, dep: unknown, minPx: number = MIN_FONT) {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState(maxSize);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) {
      setSize(maxSize);
      return;
    }
    const fits = (s: number) => {
      el.style.fontSize = `${s}px`;
      return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
    };
    const best = searchFontSize(maxSize, minPx, fits);
    el.style.fontSize = `${best}px`;
    setSize(best);
  }, [maxSize, enabled, dep, minPx]);
  return { ref, fontSize: enabled ? size : maxSize };
}
