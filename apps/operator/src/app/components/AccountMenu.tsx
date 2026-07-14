"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/useAuth";
import { isCloudMode } from "@/lib/mode";
import { isElectron, getDesktopApi } from "@/lib/desktop";
import {
  bootstrapFromElectron,
  signInFromElectron,
  signOutFromElectron,
} from "@/lib/cloudSession";
import { getCloudClient } from "@/lib/cloudAuth";

/**
 * Account UI in the primary header. Three modes:
 *
 *  - Electron, signed out: a sign-in pill that triggers the loopback
 *    OAuth flow (same as the old `CloudSignInButton`).
 *  - Electron, signed in: an avatar/email pill that opens a small menu
 *    with "Manage account" (shellOpens the cloud /account in the system
 *    browser) and "Sign out".
 *  - Cloud, signed in: same menu but "Manage account" navigates to the
 *    in-app /account route.
 *  - Cloud, signed out: no menu — the cloud build comes pre-authed from
 *    apps-portal; there's no in-app sign-in flow to show.
 *  - Either, session expired: a "Session expired" indicator that triggers
 *    re-auth on click. In Electron this re-runs the OAuth flow; in cloud
 *    it redirects back to apps-portal.
 */
export function AccountMenu() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const orgId = useAuthStore((s) => s.orgId);
  const cloud = isCloudMode();
  const inElectron = isElectron();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Initial Electron token bootstrap — same as the old CloudSignInButton
  // did. The useAuth hook handles cloud's hash-bootstrap path; for
  // Electron we need to push persisted tokens into the Supabase client.
  useEffect(() => {
    if (!inElectron) return;
    void bootstrapFromElectron();
  }, [inElectron]);

  // Close the menu when the user clicks outside or presses Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | KeyboardEvent): void => {
      if (e instanceof KeyboardEvent && e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e instanceof MouseEvent && containerRef.current) {
        if (!containerRef.current.contains(e.target as Node)) {
          setOpen(false);
        }
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onDown);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onDown);
    };
  }, [open]);

  async function signIn(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      if (inElectron) {
        await signInFromElectron();
      } else {
        // Cloud sign-in goes through apps-portal — redirect there.
        if (typeof window !== "undefined") {
          window.location.href = "https://apps.mitchellpeck.com";
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function signOut(): Promise<void> {
    if (inElectron) {
      await signOutFromElectron();
    } else {
      await getCloudClient().auth.signOut();
    }
    setOpen(false);
  }

  function openAccount(): void {
    setOpen(false);
    if (inElectron) {
      // Desktop opens the cloud account page externally so management
      // lives in one place (the cloud), not duplicated in-app.
      const api = getDesktopApi();
      if (api?.openExternal) {
        void api.openExternal("https://apps.mitchellpeck.com/account");
      } else if (typeof window !== "undefined") {
        // Fallback: same-window navigation. The Electron API may not
        // expose openExternal yet — see W6 follow-up.
        window.open("https://apps.mitchellpeck.com/account", "_blank");
      }
    } else {
      router.push("/account");
    }
  }

  // Nothing to render in cloud mode before sign-in — apps-portal handles
  // authentication and a button here would be redundant.
  if (!cloud && !inElectron) return null;
  if (cloud && status === "signed_out") return null;

  if (status === "signed_out") {
    return (
      <button
        onClick={signIn}
        disabled={busy}
        style={pillStyle}
        title="Open apps.mitchellpeck.com in your browser to sign in"
      >
        {busy ? "Signing in…" : "☁ Sign in"}
      </button>
    );
  }

  if (status === "expired") {
    return (
      <button
        onClick={signIn}
        disabled={busy}
        style={{ ...pillStyle, borderColor: "var(--amber, #f0b95c)", color: "var(--amber, #f0b95c)" }}
        title="Your session has expired — sign in again"
      >
        {busy ? "Signing in…" : "Session expired — sign in"}
      </button>
    );
  }

  // Signed in. Render a dropdown trigger + menu.
  const label = user?.email ?? "Account";
  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={pillStyle}
        title={orgId ? `Signed in (org: ${orgId})` : "Signed in"}
      >
        ☁ {truncate(label, 24)} ▾
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 4,
            minWidth: 220,
            zIndex: 100,
            boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-dim)" }}>
            {user?.email}
            {orgId && (
              <div style={{ marginTop: 2, fontFamily: "ui-monospace, monospace", fontSize: 10 }}>
                org: {orgId}
              </div>
            )}
          </div>
          <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "4px 0" }} />
          <MenuItem onClick={openAccount}>Manage account…</MenuItem>
          <MenuItem onClick={signOut} variant="destructive">
            Sign out
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  variant,
}: {
  children: React.ReactNode;
  onClick: () => void | Promise<void>;
  variant?: "destructive";
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        padding: "6px 10px",
        fontSize: 13,
        color: variant === "destructive" ? "var(--red, #f0556b)" : "var(--text)",
        cursor: "pointer",
        borderRadius: 4,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--panel-2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
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
