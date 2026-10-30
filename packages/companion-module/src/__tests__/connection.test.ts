import { describe, expect, it } from "vitest";
import { backoffMs, Connection, connectionUrl } from "../connection";

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

describe("Connection.stop", () => {
  it("does not throw an uncaught error when stopped while still connecting", async () => {
    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown) => uncaught.push(err);
    process.on("uncaughtException", onUncaught);
    try {
      const conn = new Connection(
        { host: "127.0.0.1", port: 1 },
        {
          onConnected: () => {},
          onDisconnected: () => {},
          onReconnecting: () => {},
          onMessage: () => {},
          onLog: () => {},
        },
      );
      conn.start();
      conn.stop();
      await new Promise((r) => setTimeout(r, 100));
      expect(uncaught).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });
});
