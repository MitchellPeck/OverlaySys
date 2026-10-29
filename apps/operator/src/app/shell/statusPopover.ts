// Pure content model for the top-bar status popovers. One shared layout:
// a title row, detail lines, an action row. The components own behaviour
// (what an action id does); this owns the words.

export type StatusKind = "server" | "stt" | "sync";

export interface StatusAction {
  label: string;
  id: string;
  /** Disabled with this reason shown as a tooltip. */
  disabled?: string;
}

export interface StatusPopoverModel {
  title: string;
  lines: string[];
  actions: StatusAction[];
}

export interface ServerStatusInput {
  conn: "open" | "closed" | "connecting";
  url?: string;
}
export interface SttStatusInput {
  state?: string;
  lastError?: string | null;
  /** false = no saved STT config (Start can't work). Undefined = unknown. */
  hasConfig?: boolean;
}
export interface SyncStatusInput {
  details?: string[];
  paired?: boolean;
  running?: boolean;
  busy?: boolean;
  error?: string | null;
}

type Input = ServerStatusInput | SttStatusInput | SyncStatusInput;

export function statusPopoverModel(kind: "server", s: ServerStatusInput): StatusPopoverModel;
export function statusPopoverModel(kind: "stt", s: SttStatusInput): StatusPopoverModel;
export function statusPopoverModel(kind: "sync", s: SyncStatusInput): StatusPopoverModel;
export function statusPopoverModel(kind: StatusKind, s: Input): StatusPopoverModel {
  switch (kind) {
    case "server":
      return serverModel(s as ServerStatusInput);
    case "stt":
      return sttModel(s as SttStatusInput);
    case "sync":
      return syncModel(s as SyncStatusInput);
  }
}

function serverModel(s: ServerStatusInput): StatusPopoverModel {
  const state = s.conn === "open" ? "Connected" : s.conn === "closed" ? "Disconnected" : "Connecting…";
  const lines = [`Status: ${state}`, `Address: ${s.url || "unknown"}`];
  const actions: StatusAction[] = [];
  if (s.conn !== "open") {
    lines.push("Takes and edits are not reaching the server. Reconnecting automatically.");
    actions.push({ label: "Retry now", id: "retry" });
  }
  actions.push({ label: "Copy details", id: "copy" }, { label: "Connection settings", id: "settings" });
  return { title: "Server", lines, actions };
}

function sttModel(s: SttStatusInput): StatusPopoverModel {
  const lines: string[] = [];
  if (s.state) lines.push(`Status: ${s.state}`);
  if (s.lastError) lines.push(s.lastError);
  if (s.hasConfig === false) lines.push("Missing: speech-to-text settings. Configure them first.");
  const running = s.state === "running" || s.state === "starting";
  const actions: StatusAction[] = [];
  if (running) actions.push({ label: "Stop", id: "stop" });
  else {
    actions.push({
      label: s.state === "error" ? "Retry" : "Start",
      id: "start",
      ...(s.hasConfig === false ? { disabled: "Configure speech-to-text in Settings first" } : {}),
    });
  }
  if (s.lastError) actions.push({ label: "Copy error", id: "copy-error" });
  actions.push({ label: "Speech-to-text settings", id: "settings" });
  return { title: "Speech-to-text", lines, actions };
}

function syncModel(s: SyncStatusInput): StatusPopoverModel {
  const actions: StatusAction[] = [];
  if (s.paired) {
    actions.push({
      label: s.busy ? "Starting…" : "Sync now",
      id: "sync-now",
      ...(s.busy || s.running ? { disabled: s.busy ? "Starting" : "A pass is already running" } : {}),
    });
  }
  if (s.error) actions.push({ label: "Copy error", id: "copy-error" });
  return { title: "Cloud sync", lines: s.details ?? [], actions };
}
