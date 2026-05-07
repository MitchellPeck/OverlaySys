"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type ConfirmOpts = {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type AlertOpts = {
  title?: string;
  message: ReactNode;
  okLabel?: string;
};

type DialogState =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "alert"; opts: AlertOpts; resolve: () => void }
  | null;

export function useDialog() {
  const [state, setState] = useState<DialogState>(null);
  const stateRef = useRef<DialogState>(null);
  stateRef.current = state;

  const confirm = useCallback((opts: ConfirmOpts) => {
    return new Promise<boolean>((resolve) => {
      setState({ kind: "confirm", opts, resolve });
    });
  }, []);

  const alert = useCallback((opts: AlertOpts) => {
    return new Promise<void>((resolve) => {
      setState({ kind: "alert", opts, resolve });
    });
  }, []);

  function close(result: boolean) {
    const s = stateRef.current;
    if (!s) return;
    setState(null);
    if (s.kind === "confirm") s.resolve(result);
    else s.resolve();
  }

  // Esc cancels, Enter accepts.
  useEffect(() => {
    if (!state) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        close(true);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const dialog = state ? (
    <DialogShell onBackdropClick={() => close(false)}>
      {state.kind === "confirm" ? (
        <>
          {state.opts.title && <h3 style={titleStyle}>{state.opts.title}</h3>}
          <div style={messageStyle}>{state.opts.message}</div>
          <div style={actionsStyle}>
            <button onClick={() => close(false)} style={ghostBtn} autoFocus>
              {state.opts.cancelLabel ?? "Cancel"}
            </button>
            <button
              onClick={() => close(true)}
              style={state.opts.destructive ? dangerBtn : primaryBtn}
            >
              {state.opts.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </>
      ) : (
        <>
          {state.opts.title && <h3 style={titleStyle}>{state.opts.title}</h3>}
          <div style={messageStyle}>{state.opts.message}</div>
          <div style={actionsStyle}>
            <button onClick={() => close(true)} style={primaryBtn} autoFocus>
              {state.opts.okLabel ?? "OK"}
            </button>
          </div>
        </>
      )}
    </DialogShell>
  ) : null;

  return { confirm, alert, dialog };
}

function DialogShell({
  children,
  onBackdropClick,
}: {
  children: ReactNode;
  onBackdropClick: () => void;
}) {
  return (
    <div
      onClick={onBackdropClick}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 20,
          minWidth: 320,
          maxWidth: 480,
          boxShadow: "0 12px 40px rgba(0, 0, 0, 0.5)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

const titleStyle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 14,
  fontWeight: 600,
};
const messageStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text)",
  lineHeight: 1.5,
  marginBottom: 18,
};
const actionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  justifyContent: "flex-end",
};
const primaryBtn: React.CSSProperties = {
  padding: "6px 14px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
};
const dangerBtn: React.CSSProperties = {
  ...primaryBtn,
  background: "var(--red)",
};
const ghostBtn: React.CSSProperties = {
  padding: "6px 14px",
  background: "transparent",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
};
