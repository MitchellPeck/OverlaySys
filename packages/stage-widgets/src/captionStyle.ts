import type { StageWidgetKind } from "@overlaysys/core";

export type CurrentKind = "song" | "scripture" | "graphic" | "slides" | "video";

/** Caption px: explicit size wins, else 35% of the body, never below 28 px. */
export function captionFontSize(bodyPx: number, captionSize?: number): number {
  return captionSize ?? Math.max(28, Math.round(0.35 * bodyPx));
}

const CURRENT_CAPTIONS: Record<CurrentKind, string> = {
  song: "Lyrics",
  scripture: "Scripture",
  graphic: "Graphic",
  slides: "Slides",
  video: "Video",
};

/** Caption used when `style.label` is unset (callers let `style.label` win). */
export function defaultCaption(kind: StageWidgetKind, currentKind?: CurrentKind): string | undefined {
  if (kind === "currentSlide" && currentKind) return CURRENT_CAPTIONS[currentKind];
  return undefined;
}
