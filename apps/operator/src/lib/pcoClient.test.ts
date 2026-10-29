import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPcoCredentials, disconnectPco } from "./pcoClient";

function stubFetch(status: number) {
  const f = vi.fn(async () => new Response("{}", { status }));
  vi.stubGlobal("fetch", f);
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe("clearPcoCredentials", () => {
  it("issues DELETE /api/pco/tokens", async () => {
    const f = stubFetch(200);
    await clearPcoCredentials();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/pco\/tokens$/);
    expect(init.method).toBe("DELETE");
  });
  it("maps 403 to the host-only message", async () => {
    stubFetch(403);
    await expect(clearPcoCredentials()).rejects.toThrow("Disconnect from the computer running OverlaySys.");
  });
  it("maps other failures to a generic message", async () => {
    stubFetch(500);
    await expect(clearPcoCredentials()).rejects.toThrow(/^Couldn't disconnect/);
  });
});

describe("disconnectPco", () => {
  it("clears server credentials before signing out OAuth", async () => {
    const order: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => (order.push("clear"), new Response("{}", { status: 200 }))));
    await disconnectPco(async () => void order.push("signOut"));
    expect(order).toEqual(["clear", "signOut"]);
  });
  it("never signs out when the clear fails", async () => {
    stubFetch(403);
    const signOut = vi.fn(async () => undefined);
    await expect(disconnectPco(signOut)).rejects.toThrow();
    expect(signOut).not.toHaveBeenCalled();
  });
  it("still succeeds if the OAuth sign-out throws after a clear", async () => {
    stubFetch(200);
    await expect(disconnectPco(async () => { throw new Error("x"); })).resolves.toBeUndefined();
  });
});
