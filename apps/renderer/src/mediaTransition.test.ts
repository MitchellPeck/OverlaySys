import { describe, expect, it } from "vitest";
import type { ChannelMedia } from "@overlaysys/core";
import {
  endFadeStartsAt,
  nextLayers,
  rampGain,
  shouldAnimateIn,
  transitionKeyframes,
  type MediaLayerEntry,
} from "./mediaTransition";

const FADE = { style: "fade", durationMs: 500 } as const;

function media(takenAt: number, over: Partial<ChannelMedia> = {}): ChannelMedia {
  return {
    rowId: "r", assetUrl: "/assets/a.mp4", volume: 1, endAction: "clear", mediaType: "video", fit: "contain", position: "center", loop: false, muted: false,
    transitionIn: FADE, transitionOut: FADE,
    takenAt, paused: false,
    playback: { status: "loading", currentTime: 0, duration: 0, updatedAt: 0 },
    ...over,
  };
}

describe("transitionKeyframes", () => {
  it("returns null for cut", () => {
    expect(transitionKeyframes("cut", "in")).toBeNull();
    expect(transitionKeyframes("cut", "out")).toBeNull();
  });

  it("fades opacity in and out", () => {
    expect(transitionKeyframes("fade", "in")).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(transitionKeyframes("fade", "out")).toEqual([{ opacity: 1 }, { opacity: 0 }]);
  });

  it("zoom and slide end at rest on the way in and start at rest on the way out", () => {
    for (const style of ["zoom", "slide"] as const) {
      const inn = transitionKeyframes(style, "in")!;
      const out = transitionKeyframes(style, "out")!;
      expect(inn[0]!.opacity).toBe(0);
      expect(inn[1]).toEqual({ opacity: 1, transform: "none" });
      expect(out[0]).toEqual({ opacity: 1, transform: "none" });
      expect(out[1]!.opacity).toBe(0);
      expect(inn[0]!.transform).not.toBe("none");
      expect(out[1]!.transform).not.toBe("none");
    }
  });
});

describe("rampGain", () => {
  it("interpolates linearly and clamps", () => {
    expect(rampGain(1, 0, 0, 500)).toBe(1);
    expect(rampGain(1, 0, 250, 500)).toBe(0.5);
    expect(rampGain(1, 0, 900, 500)).toBe(0);
    expect(rampGain(0.4, 0, 250, 500)).toBeCloseTo(0.2);
  });

  it("jumps straight to the target for a zero duration", () => {
    expect(rampGain(1, 0, 0, 0)).toBe(0);
  });
});

describe("endFadeStartsAt", () => {
  it("starts the Out transition one duration before the end", () => {
    expect(endFadeStartsAt(media(1), 300)).toBe(299.5);
  });

  it("is null for hold, cut, or unknown duration", () => {
    expect(endFadeStartsAt(media(1, { endAction: "hold" }), 300)).toBeNull();
    expect(endFadeStartsAt(media(1, { transitionOut: { style: "cut", durationMs: 500 } }), 300)).toBeNull();
    expect(endFadeStartsAt(media(1), 0)).toBeNull();
    expect(endFadeStartsAt(media(1), Number.NaN)).toBeNull();
  });

  it("is null for a looping video, which never reaches its end", () => {
    expect(endFadeStartsAt(media(1, { loop: true }), 300)).toBeNull();
  });

  it("never goes below zero for a clip shorter than the fade", () => {
    expect(endFadeStartsAt(media(1, { transitionOut: { style: "fade", durationMs: 3000 } }), 2)).toBe(0);
  });
});

describe("shouldAnimateIn", () => {
  it("animates a fresh take but not a renderer rejoining mid-video", () => {
    expect(shouldAnimateIn(media(1))).toBe(true);
    expect(shouldAnimateIn(media(1, { playback: { status: "playing", currentTime: 42, duration: 300, updatedAt: 0 } }))).toBe(false);
  });

  it("animates a photo while it loads but not a renderer rejoining a photo already up", () => {
    const photo = (status: "loading" | "playing") =>
      media(1, { mediaType: "image", playback: { status, currentTime: 0, duration: 0, updatedAt: 0 } });
    expect(shouldAnimateIn(photo("loading"))).toBe(true);
    expect(shouldAnimateIn(photo("playing"))).toBe(false);
  });

  it("does not animate a cut", () => {
    expect(shouldAnimateIn(media(1, { transitionIn: { style: "cut", durationMs: 500 } }))).toBe(false);
  });
});

describe("nextLayers", () => {
  const live = (m: ChannelMedia): MediaLayerEntry => ({ media: m, leaving: null });

  it("adds the first take", () => {
    expect(nextLayers([], media(1), false)).toEqual([live(media(1))]);
  });

  it("updates the live layer in place for the same take", () => {
    const paused = media(1, { paused: true });
    expect(nextLayers([live(media(1))], paused, false)).toEqual([live(paused)]);
  });

  it("a new take sends the old layer out (crossfade) and stacks the new one on top", () => {
    const out = nextLayers([live(media(1))], media(2), false);
    expect(out).toEqual([{ media: media(1), leaving: { cut: false } }, live(media(2))]);
  });

  it("a clear sends every live layer out, honoring cut", () => {
    expect(nextLayers([live(media(1))], null, false)).toEqual([{ media: media(1), leaving: { cut: false } }]);
    expect(nextLayers([live(media(1))], null, true)).toEqual([{ media: media(1), leaving: { cut: true } }]);
  });

  it("leaves already-leaving layers untouched", () => {
    const leaving: MediaLayerEntry = { media: media(1), leaving: { cut: false } };
    const out = nextLayers([leaving], null, true);
    expect(out[0]).toBe(leaving);
  });

  it("returns the same array when nothing changed", () => {
    const layers = [live(media(1))];
    expect(nextLayers(layers, layers[0]!.media, false)).toBe(layers);
    const empty: MediaLayerEntry[] = [];
    expect(nextLayers(empty, null, false)).toBe(empty);
  });
});
