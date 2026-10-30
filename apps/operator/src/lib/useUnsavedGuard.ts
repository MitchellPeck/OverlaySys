"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { chooseAction } from "@overlaysys/ui";
import { afterChoice, guardActions, leaveMethod, registerLeaveGuard, type GuardChoice, type GuardOrigin } from "@/lib/unsavedGuardFlow";
import { sentinelPopAction, shouldConfirmLinkNavigation, shouldDisarmSentinel } from "@/lib/stageDesigner";

export const DEFAULT_UNSAVED_PROMPT = "You have unsaved changes.";
const SENTINEL_FLAG = "unsavedGuard";

export type UnsavedGuardOptions = {
  /** Dialog body text. */
  message?: string;
  /**
   * Saves the draft; resolves true when saved. Adds a "Save and leave" button
   * to the dialog, and a failed save (false) keeps the user on the page.
   */
  onSave?: () => Promise<boolean>;
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
  const onSaveRef = useRef(opts.onSave);
  onSaveRef.current = opts.onSave;
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  // True while the dialog is open (a second Back/click must not stack another)
  // and, once the user chose to leave, until the page unmounts.
  const askingRef = useRef(false);
  const leavingRef = useRef(false);
  const armedHrefRef = useRef<string | null>(null);

  /** Ask; resolves true when the user chose to leave (and saved, if asked). */
  const askRef = useRef<(origin: GuardOrigin) => Promise<{ navigate: boolean; historySteps: number }>>(
    async () => ({ navigate: false, historySteps: 0 }),
  );
  askRef.current = async (origin) => {
    const canSave = !!onSaveRef.current;
    askingRef.current = true;
    try {
      const choice = (await chooseAction({
        title: "Leave without saving?",
        message: messageRef.current,
        actions: guardActions(canSave),
        cancelId: "stay",
      })) as GuardChoice;
      let saved: boolean | null = null;
      if (choice === "save" && onSaveRef.current) {
        // The save turns the draft clean, which would pop our sentinel on its
        // own; disarm first so only the navigation below moves history.
        const armed = armedHrefRef.current;
        armedHrefRef.current = null;
        try {
          saved = await onSaveRef.current();
        } catch {
          saved = false;
        }
        if (!saved) armedHrefRef.current = armed;
      }
      return afterChoice(choice, saved, origin);
    } finally {
      askingRef.current = false;
    }
  };

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
      if (!ask || leavingRef.current) return;
      // Always cancel the click; navigate ourselves if the user chooses to leave.
      e.preventDefault();
      e.stopPropagation();
      if (askingRef.current) return;
      const href = a.getAttribute("href") ?? "";
      void askRef.current("link").then((r) => {
        if (!r.navigate) return;
        leavingRef.current = true;
        armedHrefRef.current = null;
        // On the sentinel, replace it so Back from the next page doesn't
        // land on the editor twice.
        if (leaveMethod(onSentinelEntry()) === "replace") routerRef.current.replace(href);
        else routerRef.current.push(href);
      });
    };
    // Programmatic navigation (command palette, global shortcuts) asks the
    // same question a link click does, via `guardedNavigate`.
    const unregister = registerLeaveGuard(async () => {
      if (leavingRef.current || !getDirtyRef.current()) return { navigate: true, method: "push" };
      if (askingRef.current) return { navigate: false, method: "push" };
      const r = await askRef.current("link");
      if (!r.navigate) return { navigate: false, method: "push" };
      leavingRef.current = true;
      armedHrefRef.current = null;
      return { navigate: true, method: leaveMethod(onSentinelEntry()) };
    });
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      unregister();
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
  useEffect(() => {
    armedHrefRef.current = null;
    leavingRef.current = false;
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
  // Unmounting while still standing on our sentinel (no navigation replaced
  // it): neutralise it so it can't act for another page.
  useEffect(
    () => () => {
      if (armedHrefRef.current && onSentinelEntry()) {
        window.history.replaceState({ ...window.history.state, [SENTINEL_FLAG]: false }, "", window.location.href);
      }
    },
    [],
  );
  useEffect(() => {
    const onPopState = () => {
      if (leavingRef.current) return;
      // Re-push the sentinel straight away (confirm: () => false) so the page
      // stays put while the dialog is open; leaving then steps back past both.
      const action = sentinelPopAction({
        armedHref: armedHrefRef.current,
        currentHref: window.location.href,
        onSentinel: onSentinelEntry(),
        dirty: getDirtyRef.current(),
        confirm: () => false,
      });
      if (action === "none") return;
      if (action === "back") {
        armedHrefRef.current = null;
        window.history.back();
        return;
      }
      armedHrefRef.current = pushSentinel();
      if (askingRef.current) return;
      void askRef.current("pop").then((r) => {
        if (!r.navigate) return;
        leavingRef.current = true;
        armedHrefRef.current = null;
        window.history.go(r.historySteps);
      });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
}
