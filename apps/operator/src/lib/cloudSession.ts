"use client";

import { getCloudClient, getStoredRegistryOrgId } from "./cloudAuth";
import {
  getDesktopApi as getElectronApi,
  isElectron as isInElectron,
  type ElectronCloudTokens,
} from "./desktop";

/**
 * Cloud session management for the Electron host.
 *
 * In cloud mode (web operator at overlaysys.mitchellpeck.com) the
 * session comes from the URL hash on first load — see CloudBoot. In
 * Electron the session comes from the main process via IPC: the
 * loopback server captures tokens after the user signs in via
 * apps-portal, persists them with safeStorage, and pushes them to the
 * renderer.
 *
 * This module bridges Electron's IPC tokens into the same Supabase JS
 * client cloudData uses, so cloud helpers (getProjectsCloud, etc.) work
 * once the user is signed in, even though the operator is in local
 * (WS-backed) data mode for editing.
 */

const ORG_ID_STORAGE_KEY = "overlaysys:registry-org-id";

let lastBootstrap: Promise<boolean> | null = null;

/**
 * Read persisted Electron tokens via IPC and apply them to the Supabase
 * client. Returns true if a session is now active. Idempotent — repeated
 * calls just refresh.
 */
export async function bootstrapFromElectron(): Promise<boolean> {
  if (!isInElectron()) return false;
  if (!lastBootstrap) {
    lastBootstrap = (async () => {
      const api = getElectronApi();
      if (!api) return false;
      try {
        const tokens = await api.cloudGetTokens();
        if (!tokens) return false;
        return applyTokens(tokens);
      } catch (err) {
        console.warn("[cloudSession] electron bootstrap failed", err);
        return false;
      }
    })();
  }
  return lastBootstrap;
}

/**
 * Start the Electron sign-in flow. Opens the system browser, waits for
 * the loopback callback. Returns true once setSession has run with the
 * new tokens. The renderer can also subscribe to `onCloudSignedIn`
 * events on the Electron API to refresh state.
 */
export async function signInFromElectron(): Promise<boolean> {
  const api = getElectronApi();
  if (!api) return false;
  const result = await api.cloudSignIn();
  if (!result.ok) {
    console.warn("[cloudSession] sign-in failed", result.error);
    return false;
  }
  lastBootstrap = null;
  return applyTokens(result.tokens);
}

export async function signOutFromElectron(): Promise<void> {
  const api = getElectronApi();
  if (!api) return;
  await api.cloudSignOut();
  const client = getCloudClient();
  await client.auth.signOut().catch(() => undefined);
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(ORG_ID_STORAGE_KEY);
  }
  lastBootstrap = null;
}

async function applyTokens(tokens: ElectronCloudTokens): Promise<boolean> {
  const client = getCloudClient();
  const { error } = await client.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  if (error) {
    console.warn("[cloudSession] setSession failed", error);
    return false;
  }
  if (typeof window !== "undefined" && tokens.registryOrgId) {
    window.localStorage.setItem(ORG_ID_STORAGE_KEY, tokens.registryOrgId);
  }
  return true;
}

/**
 * Synchronous check: is there a registry org id persisted? Useful for UI
 * gates that need to decide "show publish/pull" before the async session
 * bootstrap finishes — the Supabase client will reject ops if the session
 * isn't actually live, so this is a hint, not a guarantee.
 */
export function hasCloudSessionHint(): boolean {
  return getStoredRegistryOrgId() !== null;
}
