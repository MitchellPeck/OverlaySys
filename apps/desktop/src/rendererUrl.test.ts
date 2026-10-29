import { describe, expect, it } from "vitest";
import { buildRendererChannelUrl } from "./rendererUrl";

const prod = { isDev: false, devRendererUrl: "http://localhost:3001", serverHost: "127.0.0.1", serverPort: 5123 };

describe("buildRendererChannelUrl", () => {
  it("builds the packaged url without audio params", () => {
    const u = new URL(buildRendererChannelUrl({ ...prod, channelId: "program" }));
    expect(u.origin + u.pathname).toBe("http://127.0.0.1:5123/renderer/");
    expect(u.searchParams.get("channel")).toBe("program");
    expect(u.searchParams.get("server")).toBe("ws://127.0.0.1:5123/ws");
    expect(u.searchParams.has("audioSinkId")).toBe(false);
  });

  it("adds encoded audio params", () => {
    const u = new URL(buildRendererChannelUrl({
      ...prod, channelId: "program",
      audioOutput: { deviceId: "a b/c", label: "Aux (USB) & more" },
    }));
    expect(u.searchParams.get("audioSinkId")).toBe("a b/c");
    expect(u.searchParams.get("audioSinkLabel")).toBe("Aux (USB) & more");
  });

  it("uses the dev renderer url in dev", () => {
    const u = new URL(buildRendererChannelUrl({ ...prod, isDev: true, channelId: "alpha", audioOutput: { deviceId: "x", label: "X" } }));
    expect(u.origin).toBe("http://localhost:3001");
    expect(u.searchParams.get("channel")).toBe("alpha");
    expect(u.searchParams.get("audioSinkLabel")).toBe("X");
    expect(u.searchParams.has("server")).toBe(false);
  });
});

describe("buildRendererChannelUrl — output label", () => {
  it("names a device output so Outputs status shows the card", () => {
    const u = new URL(buildRendererChannelUrl({ ...prod, channelId: "stage", label: "UltraStudio Express Monitor 3G" }));
    expect(u.searchParams.get("label")).toBe("UltraStudio Express Monitor 3G");
  });
});
