export type StageSize = { w: number; h: number };

export const DEFAULT_STAGE_SIZE: StageSize = { w: 1920, h: 1080 };

const MAX_DIM = 16384;

/** `?size=3840x2160` on the renderer URL pins the output resolution. */
export function readSizeOverride(search: string): StageSize | null {
  const raw = new URLSearchParams(search).get("size");
  if (!raw) return null;
  const m = /^(\d{2,5})[x×](\d{2,5})$/i.exec(raw.trim());
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w <= 0 || h <= 0 || w > MAX_DIM || h > MAX_DIM) return null;
  return { w, h };
}

/**
 * Output resolution of a renderer window. A URL override wins; otherwise the
 * stage follows the size of the template on air (so a 4K or vertical
 * template renders 1:1 instead of being clipped into a 1920×1080 box), and
 * keeps the last size when the channel clears so the frame doesn't jump.
 */
export function resolveStageSize(
  override: StageSize | null,
  templateSize: StageSize | null | undefined,
  previous: StageSize,
): StageSize {
  if (override) return override;
  if (templateSize && templateSize.w > 0 && templateSize.h > 0) {
    if (templateSize.w === previous.w && templateSize.h === previous.h) return previous;
    return { w: templateSize.w, h: templateSize.h };
  }
  return previous;
}
