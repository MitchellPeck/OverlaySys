"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button, Modal } from "@overlaysys/ui";

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

  const close = useCallback((result: boolean) => {
    const s = stateRef.current;
    if (!s) return;
    setState(null);
    if (s.kind === "confirm") s.resolve(result);
    else s.resolve();
  }, []);

  const dialog = state ? (
    state.kind === "confirm" ? (
      <Modal
        open
        size="sm"
        captureKeys
        onClose={() => close(false)}
        onCancel={() => close(false)}
        onConfirm={() => close(true)}
        title={state.opts.title}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => close(false)} autoFocus>
              {state.opts.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              variant={state.opts.destructive ? "destructive" : "primary"}
              size="sm"
              onClick={() => close(true)}
            >
              {state.opts.confirmLabel ?? "Confirm"}
            </Button>
          </>
        }
      >
        {state.opts.message}
      </Modal>
    ) : (
      <Modal
        open
        size="sm"
        captureKeys
        onClose={() => close(true)}
        onCancel={() => close(true)}
        onConfirm={() => close(true)}
        title={state.opts.title}
        footer={
          <Button variant="primary" size="sm" onClick={() => close(true)} autoFocus>
            {state.opts.okLabel ?? "OK"}
          </Button>
        }
      >
        {state.opts.message}
      </Modal>
    )
  ) : null;

  return { confirm, alert, dialog };
}
