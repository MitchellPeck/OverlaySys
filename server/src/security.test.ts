import { describe, expect, it } from "vitest";
import {
  TOKEN_COOKIE,
  checkRequest,
  isAllowedModelUrl,
  isLocalAddress,
  isLoopbackAddress,
  originAllowed,
  presentedToken,
  type SecurityContext,
} from "./security";

const ctx = (over: Partial<SecurityContext> = {}): SecurityContext => ({
  token: null,
  ownAddresses: ["192.168.1.20"],
  ownHostnames: ["studio-mac", "studio-mac.local"],
  extraOrigins: [],
  ...over,
});

describe("addresses", () => {
  it("recognises loopback in all its spellings", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.20")).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
  it("treats our own LAN address as local", () => {
    expect(isLocalAddress("::ffff:192.168.1.20", ["192.168.1.20"])).toBe(true);
    expect(isLocalAddress("192.168.1.30", ["192.168.1.20"])).toBe(false);
  });
});

describe("originAllowed", () => {
  it("allows no Origin (Companion, OBS, curl)", () => {
    expect(originAllowed(undefined, ctx())).toBe(true);
  });
  it("allows loopback on any port", () => {
    expect(originAllowed("http://localhost:3000", ctx())).toBe(true);
    expect(originAllowed("http://127.0.0.1:51234", ctx())).toBe(true);
    expect(originAllowed("http://[::1]:4000", ctx())).toBe(true);
  });
  it("allows the server's own LAN addresses and hostname", () => {
    expect(originAllowed("http://192.168.1.20:4000", ctx())).toBe(true);
    expect(originAllowed("http://studio-mac.local:3001", ctx())).toBe(true);
  });
  it("refuses other sites and opaque origins", () => {
    expect(originAllowed("https://evil.example", ctx())).toBe(false);
    expect(originAllowed("http://192.168.1.99:4000", ctx())).toBe(false);
    expect(originAllowed("null", ctx())).toBe(false);
  });
  it("allows a page from the same host name the browser used to reach us", () => {
    expect(originAllowed("http://graphics.church.lan:3000", ctx(), "graphics.church.lan:4000")).toBe(true);
    expect(originAllowed("http://evil.example", ctx(), "graphics.church.lan:4000")).toBe(false);
  });
  it("honours the explicit allow-list", () => {
    expect(originAllowed("https://tablet.lan:8443", ctx({ extraOrigins: ["https://tablet.lan:8443"] }))).toBe(true);
  });
});

describe("presentedToken", () => {
  it("reads query, bearer, then cookie", () => {
    expect(presentedToken({ url: "/ws?token=abc", headers: {} })).toEqual({ token: "abc", fromQuery: true });
    expect(presentedToken({ url: "/x", headers: { authorization: "Bearer xyz" } })).toEqual({ token: "xyz", fromQuery: false });
    expect(presentedToken({ url: "/x", headers: { cookie: `a=1; ${TOKEN_COOKIE}=c%20d` } })).toEqual({ token: "c d", fromQuery: false });
  });
});

describe("checkRequest", () => {
  it("refuses a cross-site origin even from loopback", () => {
    const r = checkRequest({ headers: { origin: "https://evil.example" }, remoteAddress: "127.0.0.1" }, ctx());
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
  it("token off: everyone with an allowed origin gets in", () => {
    expect(checkRequest({ headers: {}, remoteAddress: "192.168.1.50" }, ctx())).toMatchObject({ ok: true, local: false });
  });
  it("token on: remote needs it, local doesn't", () => {
    const c = ctx({ token: "s3cret" });
    expect(checkRequest({ headers: {}, remoteAddress: "192.168.1.50" }, c)).toMatchObject({ ok: false, status: 401 });
    expect(checkRequest({ url: "/ws?token=nope", headers: {}, remoteAddress: "192.168.1.50" }, c)).toMatchObject({ ok: false });
    expect(checkRequest({ url: "/ws?token=s3cret", headers: {}, remoteAddress: "192.168.1.50" }, c)).toMatchObject({
      ok: true,
      tokenFromQuery: true,
    });
    expect(
      checkRequest({ headers: { authorization: "Bearer s3cret" }, remoteAddress: "192.168.1.50" }, c),
    ).toMatchObject({ ok: true });
    expect(checkRequest({ headers: {}, remoteAddress: "127.0.0.1" }, c)).toMatchObject({ ok: true, local: true });
  });
});

describe("isAllowedModelUrl", () => {
  it("accepts https model hosts", () => {
    expect(isAllowedModelUrl("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin", {})).toBe(true);
    expect(isAllowedModelUrl("https://cdn-lfs.huggingface.co/x.bin", {})).toBe(true);
  });
  it("refuses http, other hosts and look-alikes", () => {
    expect(isAllowedModelUrl("http://huggingface.co/x.bin", {})).toBe(false);
    expect(isAllowedModelUrl("https://evil.example/x.bin", {})).toBe(false);
    expect(isAllowedModelUrl("https://huggingface.co.evil.example/x.bin", {})).toBe(false);
    expect(isAllowedModelUrl("not a url", {})).toBe(false);
  });
  it("extends via env", () => {
    expect(isAllowedModelUrl("https://models.lan/x.bin", { OVERLAYSYS_STT_MODEL_HOSTS: "models.lan" })).toBe(true);
  });
});
