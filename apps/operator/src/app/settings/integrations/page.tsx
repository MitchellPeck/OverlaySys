"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Panel, Pill, colors, confirm, fontSize, type PillTone } from "@overlaysys/ui";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { getDesktopApi } from "@/lib/desktop";
import { clearPcoCredentials, getPcoStatus } from "@/lib/pcoClient";
import { useAuthStore } from "@/lib/useAuth";
import { integrationStatus } from "./integrationStatus";

const TONE: Record<"muted" | "ok" | "warn", PillTone> = { muted: "dim", ok: "good", warn: "warn" };

function StatusPill({ configured, ok }: { configured: boolean; ok: boolean | null }) {
  const s = integrationStatus({ configured, ok });
  return <Pill tone={TONE[s.tone]}>{s.label}</Pill>;
}

/**
 * Settings → Integrations: one place for the accounts OverlaySys connects
 * to. Scripture is configured on its own page, so it has no card here.
 */
export default function IntegrationsPage() {
  return (
    <>
      <PageChrome title="Integrations" />
      <PageBody variant="form" style={{ height: "100%" }}>
        <PlanningCenterPanel />
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
    if (!api?.pcoSignIn) return;
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
    const ok = await confirm({
      title: "Disconnect Planning Center?",
      message: "Imports stop until you connect again. Songs and shows already imported stay.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api?.pcoSignOut?.();
      await clearPcoCredentials();
      await check();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const connected = status === "connected";
  return (
    <Panel title="Planning Center" padding="md">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <StatusPill configured={status !== "disconnected"} ok={status === "unknown" ? null : connected} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {connected && (
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </Button>
          )}
          {status === "disconnected" && api?.pcoSignIn && (
            <Button size="sm" disabled={busy} onClick={() => void connect()}>
              {busy ? "Waiting for browser…" : "Sign in with browser"}
            </Button>
          )}
          <Link href="/pco" style={{ textDecoration: "none" }}>
            <Button size="sm" variant={connected ? "secondary" : "primary"} tabIndex={-1}>
              {connected ? "Manage" : "Connect"}
            </Button>
          </Link>
        </div>
      </div>
      {error && <div style={{ color: colors.danger, fontSize: fontSize.sm, marginBottom: 8 }}>{error}</div>}
      <p style={{ color: colors.textDim, fontSize: fontSize.sm, margin: 0 }}>
        Import service plans and songs from Planning Center. Connect with your browser, or with a personal access
        token on the Planning Center page.
      </p>
    </Panel>
  );
}

function CloudPanel() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  return (
    <Panel title="OverlaySys Cloud" padding="md">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <StatusPill configured={status !== "signed_out"} ok={status === "signed_in"} />
        {status === "signed_in" && user?.email && (
          <span style={{ color: colors.textDim, fontSize: fontSize.sm }}>{user.email}</span>
        )}
        <div style={{ marginLeft: "auto" }}>
          <Link href="/account" style={{ textDecoration: "none" }}>
            <Button size="sm" tabIndex={-1}>
              {status === "signed_out" ? "Sign in" : "Account"}
            </Button>
          </Link>
        </div>
      </div>
      <p style={{ color: colors.textDim, fontSize: fontSize.sm, margin: 0 }}>
        Optional. Syncs shows, songs and designs to the cloud so they are backed up and editable on the web.
      </p>
    </Panel>
  );
}
