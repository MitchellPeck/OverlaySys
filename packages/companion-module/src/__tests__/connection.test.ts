import { describe, expect, it } from "vitest";
import { backoffMs, connectionUrl } from "../connection";

describe("connection", () => {
  it("first reconnect is fast, then backs off to 10 s", () => {
    expect(backoffMs(0)).toBe(250);
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(99)).toBe(10_000);
  });

  it("adds the LAN token only when set", () => {
    expect(connectionUrl({ host: "10.0.0.2", port: 4000 })).toBe("ws://10.0.0.2:4000/ws");
    expect(connectionUrl({ host: "10.0.0.2", port: 4000, token: "a b" })).toBe("ws://10.0.0.2:4000/ws?token=a%20b");
  });
});
