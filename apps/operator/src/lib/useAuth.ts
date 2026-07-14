"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import type { Subscription, User } from "@supabase/supabase-js";
import { create } from "zustand";
import { getCloudClient, getStoredRegistryOrgId } from "./cloudAuth";
import { isCloudMode } from "./mode";
import { isElectron, getDesktopApi } from "./desktop";

export type AuthStatus = "signed_out" | "signed_in" | "expired";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  orgId: string | null;
  /** Last time the session was verified live (ISO). null until first check. */
  lastVerifiedAt: string | null;
  /**
   * False until `useAuth` has run its first liveness check (or received its
   * first onAuthStateChange event). Consumers gating page rendering use this
   * to avoid trusting the default `signed_out` state during the brief window
   * between mount and first verification.
   */
  initialized: boolean;
  setSignedIn: (user: User, orgId: string | null) => void;
  setSignedOut: () => void;
  setExpired: () => void;
  setLastVerified: (at: string) => void;
}

/**
 * Auth-status store. Separate from the main app store so the auth surface
 * can be mounted globally without dragging in the rest of the app state.
 * Components read just the slices they need.
 */
export const useAuthStore = create<AuthState>((set) => ({
  status: "signed_out",
  user: null,
  orgId: null,
  lastVerifiedAt: null,
  initialized: false,
  setSignedIn: (user, orgId) =>
    set({
      status: "signed_in",
      user,
      orgId,
      lastVerifiedAt: new Date().toISOString(),
      initialized: true,
    }),
  setSignedOut: () =>
    set({ status: "signed_out", user: null, orgId: null, initialized: true }),
  setExpired: () =>
    set((s) => ({
      status: "expired",
      user: s.user,
      orgId: s.orgId,
      initialized: true,
    })),
  setLastVerified: (at) => set({ lastVerifiedAt: at }),
}));

/** Interval for the periodic `getUser()` liveness check. 5 minutes. */
const LIVENESS_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Throttle for on-navigation rechecks. Without this, rapid client-side
 * navigations (e.g. flipping between Shows and Songs while debugging)
 * would burn `getUser()` calls per click. Three seconds matches the
 * typical "click → server roundtrip" — slow enough not to spam, fast
 * enough that a real expiry between two intentional page loads is caught.
 */
const NAV_RECHECK_THROTTLE_MS = 3000;

/**
 * Mount this hook once at the top of the app (CloudBoot for cloud mode,
 * the operator layout for Electron mode) to keep the auth store
 * up-to-date with Supabase's auth state. Idempotent: re-mounting just
 * re-subscribes.
 *
 * Responsibilities:
 *   - Subscribe to Supabase's onAuthStateChange and reflect transitions
 *     (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED) into the store.
 *   - Periodically call `getUser()` to verify the session is still live
 *     against Supabase. If it returns no user, attempt one explicit
 *     `refreshSession()` before declaring expiry — the access token may
 *     just have lapsed during a long idle.
 *   - Re-check on tab `focus` (browser) or window `focus` (Electron) so
 *     a long-backgrounded app verifies its session before the user clicks
 *     anything that would 401.
 *
 * NOT yet wired (W6 follow-up):
 *   - TOKEN_REFRESHED → Electron IPC to persist the refreshed token to
 *     safeStorage. Without it, a desktop quit-then-relaunch after the
 *     access-token TTL loses the session.
 *   - Cross-tab sign-out propagation. Supabase JS broadcasts via
 *     BroadcastChannel by default, but the store update from
 *     onAuthStateChange isn't yet listened to on other Electron windows.
 */
export function useAuth(): void {
  // Pathname change is one of the recheck triggers. Watching it here keeps
  // the hook self-contained — every Next.js client-side navigation flows
  // through the same usePathname update.
  const pathname = usePathname();
  // Stable ref to the recheck function so the pathname effect can call
  // into the same closure that owns the Supabase client + mounted flag.
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const lastNavRecheckRef = useRef<number>(0);

  useEffect(() => {
    if (!isCloudMode() && !isElectron()) return;

    let subscription: Subscription | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let mounted = true;

    const client = getCloudClient();

    async function refreshFromClient(): Promise<void> {
      try {
        const { data, error } = await client.auth.getUser();
        if (!mounted) return;
        if (error || !data.user) {
          // No live session. Try to refresh once before declaring expiry —
          // we may just have a lapsed access token but a valid refresh
          // token still in localStorage / safeStorage.
          const { data: refreshed, error: refreshErr } =
            await client.auth.refreshSession();
          if (!mounted) return;
          if (refreshErr || !refreshed.user) {
            const wasSignedIn = useAuthStore.getState().status === "signed_in";
            if (wasSignedIn) {
              useAuthStore.getState().setExpired();
            } else {
              useAuthStore.getState().setSignedOut();
            }
            return;
          }
          useAuthStore
            .getState()
            .setSignedIn(refreshed.user, getStoredRegistryOrgId());
          return;
        }
        useAuthStore.getState().setSignedIn(data.user, getStoredRegistryOrgId());
      } catch (err) {
        if (!mounted) return;
        console.warn("[useAuth] getUser failed", err);
      }
    }
    refreshRef.current = refreshFromClient;

    // Cross-window sign-out propagation in Electron. When the user signs
    // out from another window, the main process broadcasts a sign-out
    // event to every renderer. Without this listener, this window's
    // Supabase JS client would keep its in-memory session valid until the
    // next periodic getUser() check picked up the revoked refresh token
    // — could be up to LIVENESS_INTERVAL_MS of stale UI.
    let offSignedOut: (() => void) | null = null;
    if (isElectron()) {
      const api = getDesktopApi();
      if (api?.onCloudSignedOut) {
        offSignedOut = api.onCloudSignedOut(() => {
          // Calling signOut() here fires onAuthStateChange SIGNED_OUT in
          // this window's Supabase client, which the handler below picks
          // up and reflects into the store. Catch + ignore the error if
          // there's no session to sign out of — happens when this window
          // initiated the sign-out and the broadcast loops back.
          void client.auth.signOut().catch(() => undefined);
        });
      }
    }

    const subResult = client.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      const orgId = getStoredRegistryOrgId();
      switch (event) {
        case "SIGNED_IN":
        case "USER_UPDATED":
        case "TOKEN_REFRESHED":
          if (session?.user) {
            useAuthStore.getState().setSignedIn(session.user, orgId);
          }
          // Persist refreshed tokens to safeStorage in Electron — Supabase
          // JS auto-refreshes in-memory but the file-backed copy stays
          // stale, so without this a quit + relaunch after the access-
          // token TTL loses the session. Best-effort: if the IPC isn't
          // available (older desktop build), the in-memory session still
          // works for the current run.
          if (
            event === "TOKEN_REFRESHED" &&
            isElectron() &&
            session?.access_token &&
            session.refresh_token
          ) {
            const api = getDesktopApi();
            if (api?.cloudUpdateTokens) {
              void api
                .cloudUpdateTokens({
                  accessToken: session.access_token,
                  refreshToken: session.refresh_token,
                  registryOrgId: orgId ?? undefined,
                })
                .catch((err) =>
                  console.warn("[useAuth] cloudUpdateTokens failed", err),
                );
            }
          }
          break;
        case "SIGNED_OUT":
          useAuthStore.getState().setSignedOut();
          break;
        // INITIAL_SESSION fires on subscribe; refreshFromClient handles
        // the explicit verification path so we don't double-update.
      }
    });
    subscription = subResult.data.subscription;

    void refreshFromClient();

    intervalId = setInterval(() => {
      void refreshFromClient();
    }, LIVENESS_INTERVAL_MS);

    const onFocus = (): void => {
      void refreshFromClient();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
    }

    return () => {
      mounted = false;
      refreshRef.current = null;
      if (subscription) subscription.unsubscribe();
      if (intervalId) clearInterval(intervalId);
      if (offSignedOut) offSignedOut();
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
      }
    };
  }, []);

  // Verify the session on every Next.js navigation. The mount effect
  // already ran the first check; this catches subsequent client-side
  // navs that don't unmount the layout. Throttled so debugging flips
  // between routes don't spam getUser.
  useEffect(() => {
    if (!isCloudMode() && !isElectron()) return;
    const refresh = refreshRef.current;
    if (!refresh) return;
    const now = Date.now();
    if (now - lastNavRecheckRef.current < NAV_RECHECK_THROTTLE_MS) return;
    lastNavRecheckRef.current = now;
    void refresh();
  }, [pathname]);
}
