"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Panel, colors, fontFamily, fontSize, toast } from "@overlaysys/ui";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { copyText } from "@/app/shell/clipboard";
import { useAuthStore } from "@/lib/useAuth";
import { isCloudMode } from "@/lib/mode";
import { getDesktopApi, isElectron, type DesktopDiagnostics } from "@/lib/desktop";
import { getCloudClient } from "@/lib/cloudAuth";
import { signInFromElectron, signOutFromElectron } from "@/lib/cloudSession";
import { httpBase } from "@/lib/pcoClient";

const PORTAL = "https://apps.mitchellpeck.com";

/**
 * Account management. Canonical in cloud mode; Electron typically opens
 * apps.mitchellpeck.com/account externally via AccountMenu, but the route
 * exists in the Electron build too so a same-origin navigation doesn't 404.
 * Billing / org management / member invites live in apps-portal — this page
 * links out for those.
 */
export default function AccountPage() {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const orgId = useAuthStore((s) => s.orgId);
  const initialized = useAuthStore((s) => s.initialized);
  const lastVerifiedAt = useAuthStore((s) => s.lastVerifiedAt);
  const cloud = isCloudMode();
  const inElectron = isElectron();
  const [busy, setBusy] = useState(false);

  // Signed-out users in cloud mode get redirected back to apps-portal —
  // the cloud build comes pre-authed and lacks an in-app sign-in flow.
  useEffect(() => {
    if (cloud && status === "signed_out" && typeof window !== "undefined") {
      window.location.href = PORTAL;
    }
  }, [cloud, status]);

  async function signOut(): Promise<void> {
    if (inElectron) await signOutFromElectron();
    else await getCloudClient().auth.signOut();
    router.push("/");
  }

  async function signIn(): Promise<void> {
    if (!inElectron) {
      window.open(PORTAL, "_blank");
      return;
    }
    setBusy(true);
    try {
      await signInFromElectron();
    } catch {
      toast({ tone: "error", message: "Couldn't sign in. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const signedOut = initialized && status === "signed_out";

  return (
    <>
      <PageChrome title="Account" />
      <PageBody variant="form" style={{ height: "100%" }}>
        {status === "expired" && (
          <div
            style={{
              background: colors.panel2,
              border: `1px solid ${colors.warn}`,
              borderRadius: 6,
              padding: 12,
              color: colors.warn,
              fontSize: fontSize.md,
            }}
          >
            Your session has expired. Sign in again to continue using cloud features.
          </div>
        )}

        {signedOut ? (
          <Panel title="Account" padding="md">
            <p style={{ color: colors.textDim, fontSize: fontSize.sm, margin: "0 0 12px" }}>
              Not signed in. Signing in is optional; it syncs shows, songs and designs to the cloud.
            </p>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void signIn()}>
              {busy ? "Waiting for browser…" : "Sign in"}
            </Button>
          </Panel>
        ) : (
          <>
            <Panel title="Identity" padding="md">
              <Row label="Email" value={user?.email ?? <Dim>—</Dim>} />
              <Row label="Last verified" value={formatRelative(lastVerifiedAt)} />
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer", color: colors.textDim, fontSize: fontSize.sm }}>Details</summary>
                <div style={{ marginTop: 8 }}>
                  <CopyId label="User" value={user?.id ?? null} />
                  <CopyId label="Workspace" value={orgId} />
                  {!orgId && (
                    <p style={{ color: colors.textDim, fontSize: fontSize.sm, margin: "8px 0 0" }}>
                      No workspace context. Re-launch OverlaySys from{" "}
                      <a href={PORTAL} target="_blank" rel="noreferrer" style={{ color: colors.brandText }}>
                        apps.mitchellpeck.com
                      </a>{" "}
                      so the registry workspace lands on the URL.
                    </p>
                  )}
                </div>
              </details>
            </Panel>

            <Panel title="Member and billing" padding="md">
              <p style={{ color: colors.textDim, fontSize: fontSize.sm, margin: "0 0 8px" }}>
                Workspace membership and billing live in apps-portal.
              </p>
              <Button size="sm" onClick={() => window.open(`${PORTAL}/account`, "_blank")}>
                Open apps.mitchellpeck.com
              </Button>
            </Panel>

            <Panel title="Session" padding="md">
              <Button onClick={signOut} variant="destructive" size="sm">
                Sign out
              </Button>
            </Panel>
          </>
        )}

        <Panel title="About" padding="md">
          <Row label="Version" value={<VersionLine />} />
        </Panel>
      </PageBody>
    </>
  );
}

/** Server version from /health, plus the desktop build when running in the app. */
function VersionLine() {
  const [diag, setDiag] = useState<DesktopDiagnostics | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getDesktopApi()
      ?.getDiagnostics?.()
      .then((d) => !cancelled && setDiag(d))
      .catch(() => undefined);
    fetch(`${httpBase()}/health`)
      .then((r) => (r.ok ? (r.json() as Promise<{ version?: unknown }>) : null))
      .then((j) => !cancelled && typeof j?.version === "string" && setVersion(j.version))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (!version && !diag) return <Dim>unknown</Dim>;
  return (
    <Mono>
      OverlaySys {version ?? diag?.appVersion}
      {diag ? ` · build ${diag.appVersion}${diag.isDev ? " (dev)" : ""}` : ""}
    </Mono>
  );
}

function CopyId({ label, value }: { label: string; value: string | null }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, fontSize: fontSize.sm }}>
      <span style={{ color: colors.textDim, width: 140 }}>{label}</span>
      <Button
        size="sm"
        disabled={!value}
        aria-label={`Copy ${label.toLowerCase()} id`}
        onClick={() =>
          void copyText(value ?? "").then((ok) => toast({ tone: ok ? "ok" : "error", message: ok ? "Copied" : "Couldn't copy" }))
        }
      >
        Copy id
      </Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "140px 1fr",
        gap: 12,
        alignItems: "baseline",
        marginBottom: 6,
        fontSize: fontSize.md,
      }}
    >
      <span style={{ color: colors.textDim, fontSize: fontSize.sm }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code style={{ fontFamily: fontFamily.mono, fontSize: fontSize.sm }}>{children}</code>;
}

function Dim({ children }: { children: React.ReactNode }) {
  return <span style={{ color: colors.textDim }}>{children}</span>;
}

function formatRelative(iso: string | null): React.ReactNode {
  if (!iso) return <Dim>never</Dim>;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} hr ago`;
  return new Date(iso).toLocaleString();
}
