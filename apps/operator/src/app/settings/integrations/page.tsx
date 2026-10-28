"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Panel, StatusDot, colors, fontSize } from "@overlaysys/ui";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { getDesktopApi } from "@/lib/desktop";
import { getPcoStatus } from "@/lib/pcoClient";
import { useAuthStore } from "@/lib/useAuth";

/**
 * Settings → Integrations: one place for the accounts OverlaySys connects
 * to. Planning Center sign-in used to live only on the Library import page;
 * importing plans stays there (Library → Planning Center).
 */
export default function IntegrationsPage() {
  return (
    <>
      <PageChrome title="Integrations" />
      <PageBody maxWidth={720} style={{ height: "100%" }}>
        <PlanningCenterPanel />
        <Panel title="Scripture" padding="md" style={{ marginBottom: 16 }}>
          <p style={{ color: colors.textDim, fontSize: fontSize.sm, margin: "0 0 8px" }}>
            Bible translations and the API.Bible key are set in Scripture settings.
          </p>
          <Link href="/settings/scripture" style={{ color: colors.brandText }}>
            Scripture settings →
          </Link>
        </Panel>
        <CloudPanel />
      </PageBody>
    </>
  );
}

function PlanningCenterPanel() {
  const [status, setStatus] = useState<"unknown" | "connected" | "disconnected">("unknown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = getDesktopApi();

  const check = useCallback(async () => {
    try {
      const s = await getPcoStatus();
      setStatus(s.connected ? "connected" : "disconnected");
    } catch {
      setStatus("disconnected");
    }
  }, []);

  useEffect(() => {
    void check();
    const d = getDesktopApi();
    const offIn = d?.onPcoSignedIn?.(() => void check());
    const offOut = d?.onPcoSignedOut?.(() => setStatus("disconnected"));
    return () => {
      offIn?.();
      offOut?.();
    };
  }, [check]);

  async function connect() {
    setError(null);
    if (!api?.pcoSignIn) {
      setError("Open the OverlaySys desktop app to connect Planning Center.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.pcoSignIn();
      if (!res.ok) setError(res.error);
      else setTimeout(() => void check(), 600);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!api?.pcoSignOut) return;
    setBusy(true);
    try {
      await api.pcoSignOut();
      await check();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Planning Center" padding="md" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <StatusDot
          tone={status === "connected" ? "good" : status === "unknown" ? "dim" : "warn"}
          label={status === "connected" ? "Connected" : status === "unknown" ? "Checking…" : "Not connected"}
        />
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {status === "connected" ? (
            api?.pcoSignOut && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            )
          ) : (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void connect()}>
              {busy ? "Waiting for browser…" : "Connect Planning Center"}
            </Button>
          )}
        </div>
      </div>
      {error && <div style={{ color: colors.danger, fontSize: fontSize.sm, marginBottom: 8 }}>{error}</div>}
      <p style={{ color: colors.textDim, fontSize: fontSize.sm, margin: "0 0 8px" }}>
        Sign-in opens your browser. Import service plans and songs from Library → Planning Center
        (also where a personal access token can be entered instead).
      </p>
      <Link href="/pco" style={{ color: colors.brandText }}>
        Import from Planning Center →
      </Link>
    </Panel>
  );
}

function CloudPanel() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  return (
    <Panel title="OverlaySys Cloud" padding="md">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <StatusDot
          tone={status === "signed_in" ? "good" : status === "expired" ? "warn" : "dim"}
          label={
            status === "signed_in"
              ? `Signed in${user?.email ? ` as ${user.email}` : ""}`
              : status === "expired"
                ? "Session expired"
                : "Not signed in"
          }
        />
      </div>
      <p style={{ color: colors.textDim, fontSize: fontSize.sm, margin: "0 0 8px" }}>
        Optional. Syncs shows, songs and designs to the cloud so they're backed up and editable on the web. Use
        the account menu in the top bar to sign in or out.
      </p>
      <Link href="/account" style={{ color: colors.brandText }}>
        Account details →
      </Link>
    </Panel>
  );
}
