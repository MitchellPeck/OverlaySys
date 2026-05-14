"use client";

import { useEffect, useState } from "react";
import {
  getDesktopApi as getElectronApi,
  isElectron as isInElectron,
} from "@/lib/desktop";
import {
  bootstrapFromElectron,
  signInFromElectron,
  signOutFromElectron,
} from "@/lib/cloudSession";

/**
 * Electron-only header button that lights up cloud sync. Hidden when the
 * operator runs in a web browser — the cloud operator hydrates its
 * session from the URL hash apps-portal redirects with, so a manual
 * button there would be redundant.
 *
 * Three states: never-signed-in (button "Sign in to cloud"), signed-in
 * (compact "☁ org / Sign out"), and pending (the system browser is open
 * waiting for the user). State is driven by the IPC events the main
 * process emits after the loopback finishes.
 */
export function CloudSignInButton() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isInElectron()) return;
    let cancelled = false;
    const api = getElectronApi();
    if (!api) return;
    // Initial state from persisted tokens.
    api
      .cloudGetTokens()
      .then((t) => {
        if (cancelled) return;
        if (t) {
          setSignedIn(true);
          setOrgId(t.registryOrgId);
          // Hydrate the Supabase client too so cloud helpers work without
          // a manual reload after the operator restarts.
          void bootstrapFromElectron();
        } else {
          setSignedIn(false);
        }
      })
      .catch(() => {
        if (!cancelled) setSignedIn(false);
      });
    const offIn = api.onCloudSignedIn((t) => {
      setSignedIn(true);
      setOrgId(t.registryOrgId);
    });
    const offOut = api.onCloudSignedOut(() => {
      setSignedIn(false);
      setOrgId(null);
    });
    return () => {
      cancelled = true;
      offIn();
      offOut();
    };
  }, []);

  if (!isInElectron() || signedIn === null) return null;

  if (!signedIn) {
    return (
      <button
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          try {
            await signInFromElectron();
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        style={pillStyle}
        title="Open apps.mitchellpeck.com in your browser to sign in"
      >
        {busy ? "Signing in…" : "☁ Sign in to cloud"}
      </button>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ ...pillStyle, cursor: "default" }} title={orgId ?? ""}>
        ☁ Signed in
      </span>
      <button
        onClick={async () => {
          await signOutFromElectron();
        }}
        style={{
          ...pillStyle,
          background: "transparent",
          borderColor: "var(--border)",
          color: "var(--text-dim)",
        }}
      >
        Sign out
      </button>
    </div>
  );
}

const pillStyle: React.CSSProperties = {
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  fontSize: 12,
  padding: "4px 10px",
  borderRadius: 12,
  cursor: "pointer",
};
