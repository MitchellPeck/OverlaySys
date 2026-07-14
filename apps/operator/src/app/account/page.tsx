"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button, Panel, colors } from "@overlaysys/ui";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { useAuthStore } from "@/lib/useAuth";
import { isCloudMode } from "@/lib/mode";
import { isElectron } from "@/lib/desktop";
import { getCloudClient } from "@/lib/cloudAuth";
import { signOutFromElectron } from "@/lib/cloudSession";

/**
 * Account management. Canonical in cloud mode; Electron typically opens
 * apps.mitchellpeck.com/account externally via AccountMenu, but the route
 * exists in the Electron build too so a same-origin navigation (e.g. a
 * test, or a button somewhere that didn't pick up the AccountMenu wiring)
 * doesn't 404. Surfaces identity, org context, last-verified timestamp,
 * and sign-out.
 *
 * Billing / org management / member invites all live in apps-portal —
 * this page links out for those.
 */
export default function AccountPage() {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const orgId = useAuthStore((s) => s.orgId);
  const lastVerifiedAt = useAuthStore((s) => s.lastVerifiedAt);
  const cloud = isCloudMode();
  const inElectron = isElectron();

  // Signed-out users in cloud mode get redirected back to apps-portal —
  // the cloud build comes pre-authed and lacks an in-app sign-in flow.
  useEffect(() => {
    if (cloud && status === "signed_out") {
      if (typeof window !== "undefined") {
        window.location.href = "https://apps.mitchellpeck.com";
      }
    }
  }, [cloud, status]);

  async function signOut(): Promise<void> {
    if (inElectron) {
      await signOutFromElectron();
    } else {
      await getCloudClient().auth.signOut();
    }
    router.push("/");
  }

  return (
    <>
      <PageChrome title="Account" />
      <PageBody maxWidth={640} style={{ height: "100%" }}>
        {status === "expired" && (
          <div
            style={{
              background: "var(--panel-2)",
              border: `1px solid var(--warn)`,
              borderRadius: 6,
              padding: 12,
              marginBottom: 16,
              color: "var(--warn)",
              fontSize: 13,
            }}
          >
            Your session has expired. Sign in again to continue using cloud
            features.
          </div>
        )}

        <Panel title="Identity" padding="md" style={{ marginBottom: 16 }}>
          <Row label="Email" value={user?.email ?? <Dim>not signed in</Dim>} />
          <Row label="User id" value={<Mono>{user?.id ?? "—"}</Mono>} />
          <Row label="Last verified" value={formatRelative(lastVerifiedAt)} />
        </Panel>

        <Panel title="Organization" padding="md" style={{ marginBottom: 16 }}>
          <Row label="Org id" value={orgId ? <Mono>{orgId}</Mono> : <Dim>—</Dim>} />
          {!orgId && (
            <p style={{ color: colors.textDim, fontSize: 12, marginTop: 8 }}>
              No org context — re-launch OverlaySys from{" "}
              <a
                href="https://apps.mitchellpeck.com"
                style={{ color: colors.accent2 }}
              >
                apps.mitchellpeck.com
              </a>{" "}
              so the registry org id lands on the URL.
            </p>
          )}
        </Panel>

        <Panel title="Member &amp; billing" padding="md" style={{ marginBottom: 16 }}>
          <p style={{ color: colors.textDim, fontSize: 12, margin: 0, marginBottom: 8 }}>
            Org membership and billing live in apps-portal.
          </p>
          <Button
            size="sm"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.open("https://apps.mitchellpeck.com/account", "_blank");
              }
            }}
          >
            Open apps.mitchellpeck.com →
          </Button>
        </Panel>

        <Panel title="Session" padding="md">
          <Button onClick={signOut} variant="destructive" size="sm">
            Sign out
          </Button>
        </Panel>
      </PageBody>
    </>
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
        fontSize: 13,
      }}
    >
      <span style={{ color: colors.textDim, fontSize: 12 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
      {children}
    </code>
  );
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
