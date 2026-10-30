import { describe, expect, it } from "vitest";
import { isAllowedOrigin, isSafeExternalUrl } from "./navigation";

describe("isAllowedOrigin", () => {
  const allowed = ["http://127.0.0.1:4000", "http://localhost:3000"];

  it("allows a page on an allowed origin", () => {
    expect(isAllowedOrigin("http://127.0.0.1:4000/operator/settings", allowed)).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000/?server=ws://localhost:4000/ws", allowed)).toBe(true);
  });

  it("rejects a url that only starts with an allowed origin", () => {
    expect(isAllowedOrigin("http://127.0.0.1:4000@evil.com/", allowed)).toBe(false);
    expect(isAllowedOrigin("http://127.0.0.1:40001/", allowed)).toBe(false);
    expect(isAllowedOrigin("http://localhost:3000.evil.com/", allowed)).toBe(false);
  });

  it("rejects other origins, schemes and junk", () => {
    expect(isAllowedOrigin("https://apps.mitchellpeck.com/account", allowed)).toBe(false);
    expect(isAllowedOrigin("https://127.0.0.1:4000/", allowed)).toBe(false);
    expect(isAllowedOrigin("file:///etc/passwd", allowed)).toBe(false);
    expect(isAllowedOrigin("not a url", allowed)).toBe(false);
  });

  it("never treats opaque origins as allowed", () => {
    expect(isAllowedOrigin("file:///x", ["null"])).toBe(false);
    expect(isAllowedOrigin("data:text/html,hi", ["null"])).toBe(false);
  });
});

describe("isSafeExternalUrl", () => {
  it("allows web and mail links", () => {
    expect(isSafeExternalUrl("https://apps.mitchellpeck.com/account")).toBe(true);
    expect(isSafeExternalUrl("HTTP://example.com/")).toBe(true);
    expect(isSafeExternalUrl("mailto:help@example.com")).toBe(true);
  });

  it("refuses file, network-share, custom and malformed links", () => {
    expect(isSafeExternalUrl("file:///Applications/Calculator.app")).toBe(false);
    expect(isSafeExternalUrl("smb://server/share")).toBe(false);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("vscode://file/x")).toBe(false);
    expect(isSafeExternalUrl("not a url")).toBe(false);
    expect(isSafeExternalUrl("")).toBe(false);
  });
});
