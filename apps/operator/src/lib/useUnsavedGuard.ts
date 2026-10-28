"use client";

import { useEffect, useRef } from "react";
import { sentinelPopAction, shouldConfirmLinkNavigation, shouldDisarmSentinel } from "@/lib/stageDesigner";

export const DEFAULT_UNSAVED_PROMPT = "You have unsaved changes. Leave anyway?";
const SENTINEL_FLAG = "unsavedGuard";

export type UnsavedGuardOptions = {
  /** Confirm prompt text. */
  message?: string;
  /**
   * Live dirty read for the event handlers. The `dirty` argument comes from a
   * render and can lag a store update by one; pass the store's getter when
   * that matters. Defaults to the latest `dirty` argument.
   */
  getDirty?: () => boolean;
  /**
   * Identity of the open document (e.g. the id in the URL). A new key starts
   * unarmed, so a sentinel pushed for the previous document never acts for it.
   */
  resetKey?: string;
  /**
   * False while the loaded draft doesn't belong to `resetKey` yet (the first
   * render after an in-place route switch still carries the old draft's
   * `dirty`): no sentinel is pushed then. Default true.
   */
  canArm?: boolean;
};

/** The current history entry is an unsaved-changes sentinel. */
function onSentinelEntry(): boolean {
  const st = window.history.state as Record<string, unknown> | null;
  return st?.[SENTINEL_FLAG] === true;
}

/** Push a same-URL sentinel (keeping Next's state) and return its href. */
function pushSentinel(): string {
  window.history.pushState({ ...window.history.state, [SENTINEL_FLAG]: true }, "", window.location.href);
  return window.location.href;
}

/**
 * Ask before leaving an editor with unsaved changes: tab close / reload
 * (beforeunload), in-app links (a capture-phase click catcher, since client
 * navigation never fires beforeunload) and browser Back/Forward (a same-URL
 * history sentinel pushed while dirty).
 */
export function useUnsavedGuard(dirty: boolean, opts: UnsavedGuardOptions = {}): void {
  const message = opts.message ?? DEFAULT_UNSAVED_PROMPT;
  const canArm = opts.canArm ?? true;
  const resetKey = opts.resetKey;

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const getDirtyRef = useRef<() => boolean>(() => dirtyRef.current);
  getDirtyRef.current = opts.getDirty ?? (() => dirtyRef.current);
  const messageRef = useRef(message);
  messageRef.current = message;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    // In-app links (Next <Link>, sidebar) navigate client-side, so beforeunload
    // never fires: catch the click in the capture phase, before Next's handler.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const ask = shouldConfirmLinkNavigation({
        dirty: getDirtyRef.current(),
        href: a.getAttribute("href") ?? "",
        currentHref: window.location.href,
        button: e.button,
        modified: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
        defaultPrevented: e.defaultPrevented,
        target: a.getAttribute("target"),
        download: a.hasAttribute("download"),
      });
      if (!ask || window.confirm(messageRef.current)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  // Browser Back/Forward bypasses both beforeunload and the link catcher.
  // While dirty, push a same-URL sentinel entry (spreading Next's own history
  // state so its router still treats the entry as this page) and remember its
  // href; popping it asks before leaving. Pushing also truncates forward
  // history, so Forward can't leave either. Once clean (saved/reverted) the
  // sentinel is popped again, and a new resetKey (e.g. Duplicate routing in
  // place) starts unarmed, so a stale sentinel can never act for another
  // document.
  const armedHrefRef = useRef<string | null>(null);
  useEffect(() => {
    armedHrefRef.current = null;
  }, [resetKey]);
  useEffect(() => {
    if (dirty) {
      if (!armedHrefRef.current && canArm) armedHrefRef.current = pushSentinel();
      return;
    }
    const disarm = shouldDisarmSentinel({
      armedHref: armedHrefRef.current,
      currentHref: window.location.href,
      onSentinel: onSentinelEntry(),
      dirty: false,
    });
    armedHrefRef.current = null;
    // Our popstate handler ignores this pop (nothing is armed any more).
    if (disarm) window.history.back();
  }, [dirty, resetKey, canArm]);
  useEffect(() => {
    const onPopState = () => {
      const action = sentinelPopAction({
        armedHref: armedHrefRef.current,
        currentHref: window.location.href,
        onSentinel: onSentinelEntry(),
        dirty: getDirtyRef.current(),
        confirm: () => window.confirm(messageRef.current),
      });
      if (action === "none") return;
      armedHrefRef.current = null;
      if (action === "back") window.history.back();
      else armedHrefRef.current = pushSentinel();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
}
