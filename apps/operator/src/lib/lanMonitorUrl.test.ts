import { describe, expect, it } from "vitest";
import { lanMonitorUrl } from "../app/settings/channels/lanMonitorUrl";

const a = { address: "192.168.1.20", port: 4123, channelId: "x" };
describe("lanMonitorUrl", () => {
  it("dev renderer base swaps host", () => {
    expect(lanMonitorUrl({ ...a, rendererBase: "http://localhost:3001", fromDesktop: true })).toBe(
      "http://192.168.1.20:3001/?channel=x",
    );
  });
  it("packaged uses /renderer on bound port", () => {
    expect(
      lanMonitorUrl({ ...a, rendererBase: "http://127.0.0.1:4000/renderer", fromDesktop: true }),
    ).toBe("http://192.168.1.20:4123/renderer/?channel=x");
  });
  it("web fallback uses /renderer form", () => {
    expect(lanMonitorUrl({ ...a, rendererBase: "http://localhost:3001", fromDesktop: false })).toBe(
      "http://192.168.1.20:4123/renderer/?channel=x",
    );
  });
});
