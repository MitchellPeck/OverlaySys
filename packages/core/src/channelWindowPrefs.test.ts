import { describe, expect, it } from "vitest";
import {
  ChannelWindowPrefsSchema,
  WindowPrefsFileSchema,
  type WindowPrefsFile,
} from "./channelWindowPrefs";

describe("WindowPrefsFileSchema", () => {
  it("parses a fully populated file", () => {
    const input: WindowPrefsFile = {
      version: 1,
      displays: [
        {
          id: 69733632,
          label: "DELL U2718Q",
          bounds: { x: 0, y: 0, width: 3840, height: 2160 },
          internal: false,
        },
      ],
      channels: {
        program: {
          autoOpen: true,
          displayId: 69733632,
          fullscreen: true,
          frameless: false,
          alwaysOnTop: false,
          transparent: false,
        },
      },
    };
    expect(WindowPrefsFileSchema.parse(input)).toEqual(input);
  });

  it("applies defaults for an empty file", () => {
    const parsed = WindowPrefsFileSchema.parse({});
    expect(parsed).toEqual({ version: 1, displays: [], channels: {} });
  });

  it("applies per-channel boolean defaults", () => {
    const parsed = WindowPrefsFileSchema.parse({
      channels: { program: { displayId: 1 } },
    });
    expect(parsed.channels.program).toEqual({
      autoOpen: false,
      displayId: 1,
      fullscreen: false,
      frameless: false,
      alwaysOnTop: false,
      transparent: false,
    });
  });

  it("rejects wrong-typed bounds", () => {
    expect(() =>
      WindowPrefsFileSchema.parse({
        displays: [
          { id: 1, label: "x", bounds: { x: "0", y: 0, width: 1, height: 1 }, internal: false },
        ],
      }),
    ).toThrow();
  });
});

describe("decklink output prefs", () => {
  it("accepts a decklink output and defaults its format", () => {
    const p = ChannelWindowPrefsSchema.parse({ decklink: { device: { name: "UltraStudio Express Monitor 3G" } } });
    expect(p.decklink).toEqual({ device: { name: "UltraStudio Express Monitor 3G" }, format: "1080p59.94" });
  });

  it("old prefs files without decklink still parse", () => {
    const f = WindowPrefsFileSchema.parse({ channels: { stage: { autoOpen: true } } });
    expect(f.channels.stage!.decklink).toBeUndefined();
    expect(f.decklinkFfmpegPath).toBeUndefined();
  });

  it("keeps a configured ffmpeg path", () => {
    expect(WindowPrefsFileSchema.parse({ decklinkFfmpegPath: "/opt/ff" }).decklinkFfmpegPath).toBe("/opt/ff");
  });
});
