import { describe, expect, it, vi } from "vitest";
import type { Template } from "@overlaysys/core";

vi.mock("./fonts", () => ({ ensureTemplateFonts: () => Promise.resolve() }));
vi.mock("./dom", () => ({
  applyLayerAppearance: vi.fn(),
  applyTransform: vi.fn(),
  applyVisibility: vi.fn(),
  indexLayers: vi.fn(),
  revealClipPath: vi.fn(),
  revealRefBox: vi.fn(),
  updateTemplateData: vi.fn(),
  buildTemplateDom: () => ({
    root: {
      style: {} as Record<string, string>,
      querySelectorAll: () => [],
      remove() {
        this.removed = true;
      },
      removed: false,
    },
    nodes: new Map(),
    timeBindings: [],
  }),
}));
vi.mock("./gsap-timeline", () => ({
  PROP_TO_GSAP: {},
  WIPE_VAR: "--ovs-wipe",
  clearWipeMask: vi.fn(),
  buildGsapTimeline: () => {
    throw new Error("bad tracks");
  },
}));

import { mountTemplate } from "./mount";

describe("mountTemplate", () => {
  it("removes the root it already appended when building the timelines throws", () => {
    const appended: { removed: boolean }[] = [];
    const host = { appendChild: (el: { removed: boolean }) => appended.push(el) } as unknown as HTMLElement;
    const template = {
      id: "t",
      fields: [],
      layers: [],
      timelines: { in: { duration: 1, tracks: [] }, out: { duration: 1, tracks: [] } },
    } as unknown as Template;
    expect(() => mountTemplate(host, template, {})).toThrow("bad tracks");
    expect(appended).toHaveLength(1);
    expect(appended[0]!.removed).toBe(true);
  });
});
