"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Cloud } from "lucide-react";
import { Button, toast, useContextMenu, type MenuItem } from "@overlaysys/ui";
import { useAuthStore } from "@/lib/useAuth";
import { isCloudMode } from "@/lib/mode";
import { isElectron, getDesktopApi } from "@/lib/desktop";
import {
  bootstrapFromElectron,
  signInFromElectron,
  signOutFromElectron,
} from "@/lib/cloudSession";
import { getCloudClient } from "@/lib/cloudAuth";
import { copyText } from "@/app/shell/clipboard";

/**
 * Account UI in the primary header. Three modes:
 *
 *  - Electron, signed out: a sign-in button that triggers the loopback
 *    OAuth flow.
 *  - Electron, signed in: an email button that opens a Menu with
 *    "Manage account" (shellOpens the cloud /account in the system
 *    browser) and "Sign out".
 *  - Cloud, signed in: same menu but "Manage account" navigates to the
 *    in-app /account route.
 *  - Cloud, signed out: nothing — the cloud build comes pre-authed from
 *    apps-portal; there's no in-app sign-in flow to show.
 *  - Either, session expired: a "Session expired" button that triggers
 *    re-auth. In Electron this re-runs the OAuth flow; in cloud it
 *    redirects back to apps-portal.
 */
export function AccountMenu() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const orgId = useAuthStore((s) => s.orgId);
  const cloud = isCloudMode();
  const inElectron = isElectron();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { open, menu } = useContextMenu();

  // Initial Electron token bootstrap: push persisted tokens into the
  // Supabase client. (The useAuth hook handles cloud's hash-bootstrap path.)
  useEffect(() => {
    if (!inElectron) return;
    void bootstrapFromElectron();
  }, [inElectron]);

  async function signIn(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      if (inElectron) {
        await signInFromElectron();
      } else if (typeof window !== "undefined") {
        // Cloud sign-in goes through apps-portal — redirect there.
        window.location.href = "https://apps.mitchellpeck.com";
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
  }

  function openAccount(): void {
    if (inElectron) {
      // Desktop opens the cloud account page externally so management
      // lives in one place (the cloud), not duplicated in-app.
      const api = getDesktopApi();
      if (api?.openExternal) {
        void api.openExternal("https://apps.mitchellpeck.com/account");
      } else if (typeof window !== "undefined") {
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
      <Button
        size="sm"
        icon={<Cloud size={14} aria-hidden />}
        onClick={() => void signIn()}
        disabled={busy}
        title="Open apps.mitchellpeck.com in your browser to sign in"
      >
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    );
  }

  if (status === "expired") {
    return (
      <Button
        size="sm"
        onClick={() => void signIn()}
        disabled={busy}
        title="Your session has expired. Sign in again."
      >
        {busy ? "Signing in…" : "Session expired — sign in"}
      </Button>
    );
  }

  // Signed in: a trigger that opens a Menu (role="menu").
  const label = user?.email ?? "Account";
  const items: MenuItem[] = [
    { id: "who", label, disabled: true, onSelect: () => {} },
    { id: "manage", label: "Manage account…", onSelect: openAccount },
    ...(orgId
      ? [
          {
            id: "copy-org",
            label: "Copy organization id",
            onSelect: () => {
              void copyText(orgId).then((ok) =>
                toast(ok ? { message: "Organization id copied", tone: "ok" } : { message: "Couldn't copy to the clipboard", tone: "warn" }),
              );
            },
          } satisfies MenuItem,
        ]
      : []),
    { separator: true },
    { id: "signout", label: "Sign out", danger: true, onSelect: () => void signOut() },
  ];
  return (
    <>
      <Button
        size="sm"
        onClick={(e) => open(e.currentTarget, items)}
        aria-haspopup="menu"
        aria-label={`Account: ${label}`}
        title={orgId ? "Signed in" : undefined}
        icon={<Cloud size={14} aria-hidden />}
        style={{ whiteSpace: "nowrap" }}
      >
        <span className="shell-status-label">{truncate(label, 24)}</span>
        <ChevronDown size={14} aria-hidden />
      </Button>
      {menu}
    </>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
