/** Next index for a roving-tabindex group; null when the key is not handled. Wraps. */
export function nextRovingIndex(count: number, index: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** Next index in a `cols`-wide grid of `count` cells for an arrow key (clamped at the edges); null when not handled. */
export function nextGridIndex(count: number, cols: number, index: number, key: string): number | null {
  if (count <= 0 || cols <= 0) return null;
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i));
  switch (key) {
    case "ArrowRight":
      return index % cols === cols - 1 ? index : clamp(index + 1);
    case "ArrowLeft":
      return index % cols === 0 ? index : clamp(index - 1);
    case "ArrowDown":
      return index + cols < count ? index + cols : index;
    case "ArrowUp":
      return index - cols >= 0 ? index - cols : index;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
