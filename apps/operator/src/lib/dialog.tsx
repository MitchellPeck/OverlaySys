"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button, Input, Modal } from "@overlaysys/ui";

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

type PromptOpts = {
  title?: string;
  message: ReactNode;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type DialogState =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "alert"; opts: AlertOpts; resolve: () => void }
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void }
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

  const prompt = useCallback((opts: PromptOpts) => {
    return new Promise<string | null>((resolve) => {
      setState({ kind: "prompt", opts, resolve });
    });
  }, []);

  const close = useCallback((result: boolean, value?: string) => {
    const s = stateRef.current;
    if (!s) return;
    setState(null);
    if (s.kind === "confirm") s.resolve(result);
    else if (s.kind === "prompt") s.resolve(result ? (value ?? "") : null);
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
    ) : state.kind === "alert" ? (
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
    ) : (
      <PromptModal
        opts={state.opts}
        onCancel={() => close(false)}
        onConfirm={(v) => close(true, v)}
      />
    )
  ) : null;

  return { confirm, alert, prompt, dialog };
}

function PromptModal({
  opts,
  onCancel,
  onConfirm,
}: {
  opts: PromptOpts;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(opts.defaultValue ?? "");
  return (
    <Modal
      open
      size="sm"
      captureKeys
      onClose={onCancel}
      onCancel={onCancel}
      onConfirm={() => onConfirm(value)}
      title={opts.title}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {opts.cancelLabel ?? "Cancel"}
          </Button>
          <Button variant="primary" size="sm" onClick={() => onConfirm(value)}>
            {opts.confirmLabel ?? "OK"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>{opts.message}</div>
        <Input
          autoFocus
          value={value}
          placeholder={opts.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) {
              e.preventDefault();
              onConfirm(value);
            }
          }}
        />
      </div>
    </Modal>
  );
}
