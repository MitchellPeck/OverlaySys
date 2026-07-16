import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { isAddrInUse, listenWithFallback } from "./serverBoot";

const HOST = "127.0.0.1";
const open: FastifyInstance[] = [];

function makeApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  open.push(app);
  return app;
}

afterEach(async () => {
  while (open.length) {
    const app = open.pop();
    try {
      await app?.close();
    } catch {
      /* ignore */
    }
  }
});

describe("isAddrInUse", () => {
  it("recognizes EADDRINUSE errors", () => {
    expect(isAddrInUse({ code: "EADDRINUSE" })).toBe(true);
  });
  it("ignores other errors and non-objects", () => {
    expect(isAddrInUse({ code: "EACCES" })).toBe(false);
    expect(isAddrInUse(new Error("nope"))).toBe(false);
    expect(isAddrInUse(null)).toBe(false);
    expect(isAddrInUse("EADDRINUSE")).toBe(false);
  });
});

describe("listenWithFallback", () => {
  it("binds the requested port when it is free", async () => {
    const app = makeApp();
    // Ask the OS for a free port first, then bind it explicitly.
    const probe = makeApp();
    const probePort = await listenWithFallback(probe, HOST, 0);
    await probe.close();
    open.splice(open.indexOf(probe), 1);

    const bound = await listenWithFallback(app, HOST, probePort);
    expect(bound).toBe(probePort);
  });

  it("falls back to an ephemeral port when the requested port is taken", async () => {
    const holder = makeApp();
    const port = await listenWithFallback(holder, HOST, 0);
    expect(port).toBeGreaterThan(0);

    // Second server wants the SAME fixed port — must not throw, must land
    // on a different, real port.
    const second = makeApp();
    const bound = await listenWithFallback(second, HOST, port);
    expect(bound).toBeGreaterThan(0);
    expect(bound).not.toBe(port);

    const addr = second.server.address();
    expect(typeof addr === "object" && addr ? addr.port : -1).toBe(bound);
  });

  it("does not fall back (and rethrows) when port is 0-based ephemeral already", async () => {
    const app = makeApp();
    const bound = await listenWithFallback(app, HOST, 0);
    expect(bound).toBeGreaterThan(0);
  });
});
