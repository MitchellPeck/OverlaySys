"use client";

import { useEffect, useState } from "react";
import { isCloudMode } from "@/lib/mode";
import { bootstrapFromHash } from "@/lib/cloudAuth";
import { isElectron as isInElectron } from "@/lib/desktop";
import { bootstrapFromElectron } from "@/lib/cloudSession";

/**
 * Top-level boot effect that runs once per browser tab in cloud mode.
 * Parses the hash apps-portal redirects with, hydrates a Supabase session,
 * and (if not signed in) renders a "sign in" prompt instead of the app.
 *
 * In local mode this component is inert — renders children directly with
 * no effects, no Supabase imports executed at runtime.
 */
export function CloudBoot({ children }: { children: React.ReactNode }) {
  if (isCloudMode()) return <CloudBootInner>{children}</CloudBootInner>;
  // In Electron, we still want to hydrate the cloud session if the user
  // has signed in previously — kicked off as a side effect, doesn't gate
  // the UI. The local-mode WS path is the primary, so children render
  // immediately while bootstrap settles in the background.
  return <ElectronSessionBoot>{children}</ElectronSessionBoot>;
}

function ElectronSessionBoot({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!isInElectron()) return;
    void bootstrapFromElectron();
  }, []);
  return <>{children}</>;
}

function CloudBootInner({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<
    "loading" | "signed-in" | "signed-out" | "no-org" | "error"
  >("loading");
  const [registryOrgId, setRegistryOrgId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    bootstrapFromHash()
      .then((result) => {
        if (cancelled) return;
        setRegistryOrgId(result.registryOrgId);
        if (!result.signedIn) {
          setState("signed-out");
        } else if (!result.registryOrgId) {
          setState("no-org");
        } else {
          setState("signed-in");
        }
      })
      .catch((err) => {
        console.warn("[CloudBoot] bootstrap failed", err);
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          color: "var(--text-dim)",
          fontSize: 13,
        }}
      >
        Connecting…
      </div>
    );
  }

  if (state === "signed-out") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Sign in required</h1>
          <p style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 16 }}>
            OverlaySys uses one-click sign-in from apps.mitchellpeck.com. Open
            it there to launch the operator with a fresh session.
          </p>
          <a
            href="https://apps.mitchellpeck.com"
            style={{
              display: "inline-block",
              padding: "8px 16px",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
              textDecoration: "none",
              background: "var(--panel-2)",
              fontSize: 14,
            }}
          >
            Open apps.mitchellpeck.com
          </a>
        </div>
      </div>
    );
  }

  if (state === "no-org") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Signed in — no org context</h1>
          <p style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 8 }}>
            Your Supabase session is active, but the redirect from
            apps.mitchellpeck.com didn't include a <code>registry_org_id</code>.
            That field is added by a recent change to apps-portal's
            <code> /api/apps/[id]/open</code> route — if you tested against
            an older build of apps-portal, restart its dev server (or
            redeploy) and click Open OverlaySys again.
          </p>
          <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
            Once the URL hash carries the org id, the operator will load
            this org's projects automatically.
          </p>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          color: "var(--red, #f87171)",
          fontSize: 13,
        }}
      >
        Failed to connect to the cloud. Reload to try again.
      </div>
    );
  }

  // Signed-in: registryOrgId has already been persisted to localStorage
  // by bootstrapFromHash. lib/cloudData.ts reads it via
  // getStoredRegistryOrgId() so reloads work without re-parsing a hash.
  void registryOrgId;
  return <>{children}</>;
}
