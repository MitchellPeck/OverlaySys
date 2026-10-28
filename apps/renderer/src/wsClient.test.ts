import { describe, expect, it } from "vitest";
import { heartbeatAction, reconnectDelay, resolveServerUrl } from "./wsClient";

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
  it("forwards a LAN token from the page URL", () => {
    expect(resolveServerUrl({ ...base, search: "?channel=a&token=s%20t", pathname: "/renderer/" })).toBe(
      "ws://localhost:3001/ws?token=s%20t",
    );
  });
  it("dev server falls back to hostname:4000", () => {
    expect(resolveServerUrl(base)).toBe("ws://localhost:4000/ws");
  });
});

describe("heartbeat + backoff", () => {
  it("first reconnect is fast, then backs off to 10 s", () => {
    expect(reconnectDelay(0)).toBe(250);
    expect(reconnectDelay(1)).toBe(500);
    expect(reconnectDelay(50)).toBe(10_000);
  });
  it("gives up on a socket silent for over 10 s", () => {
    expect(heartbeatAction(10_000, 5_000)).toBe("ping");
    expect(heartbeatAction(20_001, 10_000)).toBe("reconnect");
  });
});
