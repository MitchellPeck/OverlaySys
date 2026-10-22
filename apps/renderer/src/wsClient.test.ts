import { describe, expect, it } from "vitest";
import { resolveServerUrl } from "./wsClient";

const base = { search: "", protocol: "http:", host: "localhost:3001", hostname: "localhost", pathname: "/" };

describe("resolveServerUrl", () => {
  it("?server override wins", () => {
    expect(
      resolveServerUrl({ ...base, search: "?channel=a&server=ws://127.0.0.1:5000/ws", pathname: "/renderer/" }),
    ).toBe("ws://127.0.0.1:5000/ws");
  });
  it("uses same origin when served under /renderer", () => {
    expect(
      resolveServerUrl({ ...base, host: "192.168.1.20:4123", hostname: "192.168.1.20", pathname: "/renderer/" }),
    ).toBe("ws://192.168.1.20:4123/ws");
  });
  it("uses wss on https", () => {
    expect(
      resolveServerUrl({ ...base, protocol: "https:", host: "x.local:443", hostname: "x.local", pathname: "/renderer/index.html" }),
    ).toBe("wss://x.local:443/ws");
  });
  it("dev server falls back to hostname:4000", () => {
    expect(resolveServerUrl(base)).toBe("ws://localhost:4000/ws");
  });
});
