import { describe, expect, it } from "vitest";
import type { Timeline } from "@overlaysys/core";
import { cubicBezierEase } from "./cubicBezier";
import { buildGsapTimeline, easingToGsap } from "./gsap-timeline";

describe("cubicBezierEase", () => {
  it("is linear for [0,0,1,1]", () => {
    const f = cubicBezierEase(0, 0, 1, 1);
    for (const t of [0.25, 0.5, 0.75]) expect(Math.abs(f(t) - t)).toBeLessThan(1e-3);
  });
  it("matches CSS ease-in-out", () => {
    const f = cubicBezierEase(0.42, 0, 0.58, 1);
    expect(Math.abs(f(0.5) - 0.5)).toBeLessThan(1e-3);
    expect(Math.abs(f(0.25) - 0.1291)).toBeLessThan(2e-3);
  });
  it("handles overshoot curves and endpoints", () => {
    const f = cubicBezierEase(0.68, -0.55, 0.27, 1.55);
    const v = f(0.5);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1.6);
    expect(f(1)).toBe(1);
    expect(f(0)).toBe(0);
  });
});

describe("easingToGsap", () => {
  it("returns a function for a bezier tuple and passes strings through", () => {
    expect(typeof easingToGsap([0.42, 0, 0.58, 1])).toBe("function");
    expect(easingToGsap("power2.out")).toBe("power2.out");
  });
});

describe("buildGsapTimeline", () => {
  it("uses a function ease for a tuple easing", () => {
    const spec = {
      duration: 1,
      tracks: [
        {
          layerId: "a",
          property: "x",
          keyframes: [
            { t: 0, value: 0, easing: "linear" },
            { t: 1, value: 100, easing: [0.42, 0, 0.58, 1] },
          ],
        },
      ],
    } as unknown as Timeline;
    const el = { x: 0 } as unknown as HTMLElement;
    const tl = buildGsapTimeline(spec, new Map([["a", el]]) as never);
    const tween = tl.getChildren(false)[0] as gsap.core.Tween;
    expect(typeof tween.vars.ease).toBe("function");
  });
});
