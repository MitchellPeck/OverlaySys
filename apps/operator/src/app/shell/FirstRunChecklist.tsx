"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { Button, colors, fontSize, fontWeight } from "@overlaysys/ui";
import { AnchoredPopover } from "@/app/components/AnchoredPopover";
import { getDesktopApi, isElectron } from "@/lib/desktop";
import { getPcoStatus } from "@/lib/pcoClient";
import { useStore } from "@/lib/store";
import { useAuthStore } from "@/lib/useAuth";
import { FIRST_RUN_DISMISSED_KEY, buildChecklist, checklistProgress, type ChecklistInputs } from "./shellStatus";

/** Window event the command palette fires to bring the checklist back. */
export const OPEN_FIRST_RUN_EVENT = "overlaysys:open-first-run";

function useDesktopSetupState(): Pick<ChecklistInputs, "outputsConfigured" | "pcoConnected"> {
  const [outputsConfigured, setOutputs] = useState(false);
  const [pcoConnected, setPco] = useState(false);
  useEffect(() => {
    const api = getDesktopApi();
    if (!api) return;
    let cancelled = false;
    const refreshOutputs = () => {
      void Promise.all([api.getChannelWindowPrefs().catch(() => null), api.listChannelWindows().catch(() => [])]).then(
        ([prefs, open]) => {
          if (cancelled) return;
          const saved = Object.values(prefs?.channels ?? {}).some((c) => c.displayId !== undefined || c.autoOpen);
          setOutputs(saved || open.length > 0);
        },
      );
    };
    // Server-side status also counts a personal-access-token connection.
    const refreshPco = () => {
      void getPcoStatus().then((s) => !cancelled && setPco(s.connected)).catch(() => undefined);
    };
    refreshOutputs();
    refreshPco();
    const offs = [
      api.onChannelWindowOpened(refreshOutputs),
      api.onPcoSignedIn?.(refreshPco),
      api.onPcoSignedOut?.(refreshPco),
    ];
    // Prefs are saved from Settings → Channels without an event; re-check on focus.
    window.addEventListener("focus", refreshOutputs);
    return () => {
      cancelled = true;
      for (const off of offs) off?.();
      window.removeEventListener("focus", refreshOutputs);
    };
  }, []);
  return { outputsConfigured, pcoConnected };
}

/**
 * "Get started 1/3" button in the top bar on a fresh desktop install. Opens a
 * checklist (outputs, Planning Center, STT microphone, optional cloud
 * sign-in). Hides itself once the required steps are done or the operator
 * dismisses it; the command palette can bring it back.
 */
export function FirstRunChecklist() {
  const [dismissed, setDismissed] = useState(true); // until localStorage is read
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const desktop = useDesktopSetupState();
  const sttConfig = useStore((s) => s.sttSpawnerConfig);
  const sttState = useStore((s) => s.sttSpawnerStatus?.state);
  const authStatus = useAuthStore((s) => s.status);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(FIRST_RUN_DISMISSED_KEY) === "1");
    } catch {
      setDismissed(false);
    }
    const reopen = () => {
      try {
        localStorage.removeItem(FIRST_RUN_DISMISSED_KEY);
      } catch {
        /* ignore */
      }
      setDismissed(false);
      setOpen(true);
    };
    window.addEventListener(OPEN_FIRST_RUN_EVENT, reopen);
    return () => window.removeEventListener(OPEN_FIRST_RUN_EVENT, reopen);
  }, []);

  const items = buildChecklist({
    ...desktop,
    sttConfigured: sttState === "running" || (!!sttConfig && (sttConfig.captureDevice >= 0 || sttConfig.autoStart)),
    cloudSignedIn: authStatus === "signed_in",
  });
  const { done, total } = checklistProgress(items);

  if (!isElectron() || dismissed) return null;
  // Done with the required steps and not explicitly reopened: get out of the way.
  if (done === total && !open) return null;

  function dismiss() {
    try {
      localStorage.setItem(FIRST_RUN_DISMISSED_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: colors.brandSubtle,
          border: `1px solid ${colors.border}`,
          color: colors.text,
          borderRadius: 999,
          padding: "3px 10px",
          fontSize: fontSize.sm,
          fontWeight: fontWeight.medium,
          whiteSpace: "nowrap",
        }}
      >
        Get started {done}/{total}
      </button>
      {open && (
        <AnchoredPopover anchorEl={ref.current} onClose={() => setOpen(false)} width={320}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 4 }}>
            <div style={{ fontWeight: fontWeight.semibold }}>Set up this computer</div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((it) => (
                <li key={it.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  {it.done ? (
                    <CheckCircle2 size={16} aria-label="Done" style={{ color: colors.ok, flexShrink: 0, marginTop: 1 }} />
                  ) : (
                    <Circle size={16} aria-label="Not done" style={{ color: colors.textMuted, flexShrink: 0, marginTop: 1 }} />
                  )}
                  <div>
                    <Link
                      href={it.href}
                      onClick={() => setOpen(false)}
                      style={{ color: it.done ? colors.textDim : colors.text, fontWeight: fontWeight.medium }}
                    >
                      {it.label}
                    </Link>
                    <div style={{ color: colors.textDim, fontSize: fontSize.sm }}>{it.hint}</div>
                  </div>
                </li>
              ))}
            </ul>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button size="sm" variant="ghost" onClick={dismiss}>
                Hide checklist
              </Button>
            </div>
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}
