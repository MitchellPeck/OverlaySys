export type IntegrationTone = "muted" | "ok" | "warn";

/** Status chip for an integration card. Unconfigured wins over everything. */
export function integrationStatus(i: { configured: boolean; ok: boolean | null }): {
  tone: IntegrationTone;
  label: string;
} {
  if (!i.configured) return { tone: "muted", label: "Not set up" };
  if (i.ok === null) return { tone: "muted", label: "Checking…" };
  return i.ok ? { tone: "ok", label: "Connected" } : { tone: "warn", label: "Set up, not responding" };
}
