// Help-menu helpers: the "Copy diagnostics" text, LAN addresses, the
// keyboard-shortcut reference and HTML escaping for the identify overlay.
// Pure (no `electron` import) so they are unit-testable.

import type os from "node:os";

export interface DiagnosticsDisplay {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  internal: boolean;
  primary: boolean;
}

export interface DiagnosticsInfo {
  appVersion: string;
  electron: string;
  node: string;
  chrome: string;
  platform: string;
  arch: string;
  isDev: boolean;
  serverPort: number;
  bindHost: string;
  lanAddresses: string[];
  displays: DiagnosticsDisplay[];
  openOutputs: string[];
  logPath: string;
}

/** Non-internal IPv4 addresses, the ones another device on the LAN can reach. */
export function lanIPv4Addresses(
  ifaces: ReturnType<typeof os.networkInterfaces>,
): string[] {
  const out: string[] = [];
  for (const list of Object.values(ifaces)) {
    for (const a of list ?? []) {
      // Node 18.0–18.3 reported family as a number.
      const fam = a.family as string | number;
      if ((fam === "IPv4" || fam === 4) && !a.internal) out.push(a.address);
    }
  }
  return out;
}

export function formatDiagnostics(d: DiagnosticsInfo): string {
  const lines = [
    `OverlaySys ${d.appVersion}${d.isDev ? " (dev)" : ""}`,
    `Electron ${d.electron} · Node ${d.node} · Chrome ${d.chrome}`,
    `Platform ${d.platform}/${d.arch}`,
    `Server port ${d.serverPort} · bind ${d.bindHost}`,
    `LAN addresses: ${d.lanAddresses.length ? d.lanAddresses.join(", ") : "none detected"}`,
    `Open outputs: ${d.openOutputs.length ? d.openOutputs.join(", ") : "none"}`,
    `Displays (${d.displays.length}):`,
    ...d.displays.map(
      (s) =>
        `  - #${s.id} ${s.label || "unlabeled"} ${s.bounds.width}x${s.bounds.height}` +
        ` @${s.bounds.x},${s.bounds.y} scale ${s.scaleFactor}` +
        `${s.internal ? " internal" : ""}${s.primary ? " primary" : ""}`,
    ),
    `Log: ${d.logPath}`,
  ];
  return lines.join("\n");
}

/** Shortcut reference shown from Help → Keyboard Shortcuts. */
export function keyboardShortcutsText(isMac: boolean): string {
  const mod = isMac ? "⌘" : "Ctrl+";
  return [
    "Anywhere",
    `  ${mod}K            Command palette`,
    `  ${mod}Shift+L      Toggle Live / last page`,
    "",
    "Live — graphics",
    "  ↑ / ↓          Move rundown selection",
    "  Enter          Cue selected row to preview",
    "  Space          Take selected row to program",
    `  ${mod}Enter        Swap preview and program`,
    "  Esc            Clear program",
    "",
    "Live — song on program",
    "  Space          Next slide",
    "  Shift+Space    Previous slide",
    "  C / B / T      Chorus / Bridge / Tag",
    "  1–9, 0         Verse 1–9, Verse 10",
    "  .              Toggle blank",
    "  Esc            End song",
  ].join("\n");
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
