import { describe, expect, it } from "vitest";
import type { SttPresence } from "@overlaysys/core";
import { presenceView, sttConfigEqual } from "./sttDraft";

const present = {
  binary: { path: "/bin/whisper-stream", version: "1" },
  selectedModel: { path: "/m.bin", filename: "m.bin", sizeBytes: 1, present: true },
  platform: "darwin",
  packageManager: "brew",
} as unknown as SttPresence;

describe("presenceView", () => {
  it("is loading while presence is undefined or null", () => {
    expect(presenceView(undefined)).toBe("loading");
    expect(presenceView(null)).toBe("loading");
  });
  it("is present when binary and model exist", () => {
    expect(presenceView(present)).toBe("present");
  });
  it("is missing when the model file is absent", () => {
    expect(presenceView({ ...present, selectedModel: { ...present.selectedModel, present: false } })).toBe("missing");
  });
  it("is missing when the binary has no path", () => {
    expect(presenceView({ ...present, binary: { path: null, version: null } } as unknown as SttPresence)).toBe("missing");
  });
});

describe("sttConfigEqual", () => {
  it("ignores key order", () => {
    expect(sttConfigEqual({ a: 1, b: { c: 2, d: 3 } } as never, { b: { d: 3, c: 2 }, a: 1 } as never)).toBe(true);
  });
  it("detects differences", () => {
    expect(sttConfigEqual({ a: 1 } as never, { a: 2 } as never)).toBe(false);
  });
});
