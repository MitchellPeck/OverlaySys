import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT_ID, SIGNAL_FORMATS, deckLinkErrorText, findFormat } from "./deckLinkOutput";

describe("signal formats", () => {
  it("ships only 1080p59.94, as an exact NTSC fraction", () => {
    expect(SIGNAL_FORMATS.map((f) => f.id)).toEqual(["1080p59.94"]);
    expect(findFormat("1080p59.94")).toMatchObject({ width: 1920, height: 1080, rate: "60000/1001" });
    expect(DEFAULT_FORMAT_ID).toBe("1080p59.94");
  });

  it("unknown format id falls back to 1080p59.94", () => {
    expect(findFormat("nope").id).toBe("1080p59.94");
  });
});

describe("deckLinkErrorText", () => {
  it("names the device and never shows raw ffmpeg text", () => {
    expect(deckLinkErrorText("device-busy", "UltraStudio")).toContain("“UltraStudio” is in use by another program");
    expect(deckLinkErrorText("device-ambiguous", "X")).toBe("Two devices are called “X”. OverlaySys won't guess which one to use.");
    expect(deckLinkErrorText("ffmpeg-not-found", "X")).toContain("Settings → Connection");
  });
});
