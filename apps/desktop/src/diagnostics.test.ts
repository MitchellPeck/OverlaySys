import { describe, expect, it } from "vitest";
import { escapeHtml, formatDiagnostics, keyboardShortcutsText, lanIPv4Addresses } from "./diagnostics";

describe("escapeHtml", () => {
  it("escapes markup in display labels", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">&'`)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;",
    );
  });
});

describe("lanIPv4Addresses", () => {
  it("keeps external IPv4 only", () => {
    expect(
      lanIPv4Addresses({
        lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true } as never],
        en0: [
          { address: "192.168.1.20", family: "IPv4", internal: false } as never,
          { address: "fe80::1", family: "IPv6", internal: false } as never,
        ],
      }),
    ).toEqual(["192.168.1.20"]);
  });
});

describe("formatDiagnostics", () => {
  it("includes version, port, LAN and displays", () => {
    const text = formatDiagnostics({
      appVersion: "0.0.1",
      electron: "33.2.0",
      node: "20.18.0",
      chrome: "130",
      platform: "darwin",
      arch: "arm64",
      isDev: false,
      serverPort: 4000,
      bindHost: "0.0.0.0",
      lanAddresses: ["192.168.1.20"],
      displays: [
        { id: 1, label: "Built-in", bounds: { x: 0, y: 0, width: 1512, height: 982 }, scaleFactor: 2, internal: true, primary: true },
      ],
      openOutputs: ["program"],
      logPath: "/tmp/boot.log",
    });
    expect(text).toContain("OverlaySys 0.0.1");
    expect(text).toContain("Server port 4000 · bind 0.0.0.0");
    expect(text).toContain("192.168.1.20");
    expect(text).toContain("#1 Built-in 1512x982 @0,0 scale 2 internal primary");
    expect(text).toContain("Open outputs: program");
  });
});

describe("keyboardShortcutsText", () => {
  it("uses the platform modifier", () => {
    expect(keyboardShortcutsText(true)).toContain("⌘K");
    expect(keyboardShortcutsText(false)).toContain("Ctrl+K");
  });
});
