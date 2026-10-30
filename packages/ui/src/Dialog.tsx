"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "./Button";
import { Input } from "./Input";
import { Modal } from "./Modal";
import { confirmInitialFocus } from "./modalKeys";
import { colors, fontSize, space } from "./tokens";
import {
  createDialogStore,
  type ActiveDialog,
  type AlertOptions,
  type ChooseActionOptions,
  type ConfirmOptions,
  type PromptOptions,
} from "./dialogStore";

export type { AlertOptions, ChooseActionOptions, ConfirmOptions, PromptOptions } from "./dialogStore";

/** The styled dialog shell. Same component as `Modal`, under the contract name. */
export const Dialog = Modal;

// One app-wide queue; `<DialogHost />` (mounted once in the root layout)
// renders whichever dialog is at its head.
const store = createDialogStore();

/** Above page-level Modals (1000), below toasts. */
const DIALOG_Z = 1100;

export function confirm(o: ConfirmOptions): Promise<boolean> {
  return store.open({ kind: "confirm", ...o }, false);
}

/** Resolves the trimmed value, or null when cancelled. */
export function prompt(o: PromptOptions): Promise<string | null> {
  return store.open<string | null>({ kind: "prompt", ...o }, null);
}

/** Resolves the chosen action id; Esc / backdrop resolve `cancelId`. */
export function chooseAction(o: ChooseActionOptions): Promise<string> {
  return store.open({ kind: "choose", ...o }, o.cancelId);
}

export function alertDialog(o: AlertOptions): Promise<void> {
  return store.open<void>({ kind: "alert", ...o }, undefined);
}

export function useConfirm(): (o: ConfirmOptions) => Promise<boolean> {
  return confirm;
}

export function usePrompt(): (o: PromptOptions) => Promise<string | null> {
  return prompt;
}

/** Error under a prompt's field, or null when the value can be submitted. */
export function promptError(o: Pick<PromptOptions, "required" | "validate">, value: string): string | null {
  const v = value.trim();
  if (o.required && !v) return "Enter a name";
  return o.validate?.(v) ?? null;
}

// Legacy useDialog callers may omit the title: no empty header bar then, but
// the dialog still has an accessible name.
function titleProps(title: string) {
  return title ? { title } : { ariaLabel: "Dialog" };
}

export function DialogHost() {
  const active = useSyncExternalStore(store.subscribe, store.current, () => null);
  if (!active) return null;
  // Keyed by id so a queued dialog never inherits the previous one's state.
  return <ActiveDialogView key={active.id} active={active} />;
}

function ActiveDialogView({ active }: { active: ActiveDialog }) {
  const { spec } = active;
  const done = (v: unknown) => store.resolve(v);

  if (spec.kind === "confirm") {
    const focusConfirm = confirmInitialFocus(spec) === "confirm";
    return (
      <Modal
        open
        size="sm"
        zIndex={DIALOG_Z}
        danger={spec.danger}
        {...titleProps(spec.title)}
        onClose={() => done(false)}
        onCancel={() => done(false)}
        onConfirm={() => done(true)}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              data-autofocus={focusConfirm ? undefined : true}
              onClick={() => done(false)}
            >
              {spec.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              variant={spec.danger ? "destructive" : "primary"}
              size="sm"
              data-dialog-confirm
              data-autofocus={focusConfirm ? true : undefined}
              onClick={() => done(true)}
            >
              {spec.confirmLabel}
            </Button>
          </>
        }
      >
        {spec.message}
      </Modal>
    );
  }

  if (spec.kind === "alert") {
    return (
      <Modal
        open
        size="sm"
        zIndex={DIALOG_Z}
        {...titleProps(spec.title)}
        onClose={() => done(undefined)}
        onCancel={() => done(undefined)}
        onConfirm={() => done(undefined)}
        footer={
          <Button variant="primary" size="sm" data-autofocus onClick={() => done(undefined)}>
            {spec.okLabel ?? "OK"}
          </Button>
        }
      >
        {spec.message}
      </Modal>
    );
  }

  if (spec.kind === "choose") {
    return (
      <Modal
        open
        size="sm"
        zIndex={DIALOG_Z}
        {...titleProps(spec.title)}
        onClose={() => done(spec.cancelId)}
        onCancel={() => done(spec.cancelId)}
        footer={
          <>
            {spec.actions.map((a) => (
              <Button
                key={a.id}
                variant={a.variant ?? "secondary"}
                size="sm"
                data-autofocus={a.id === spec.cancelId ? true : undefined}
                onClick={() => done(a.id)}
              >
                {a.label}
              </Button>
            ))}
          </>
        }
      >
        {spec.message}
      </Modal>
    );
  }

  return <PromptView spec={spec} onDone={done} />;
}

function PromptView({ spec, onDone }: { spec: PromptOptions; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(spec.defaultValue ?? "");
  const error = promptError(spec, value);
  const submit = () => {
    if (error === null) onDone(value.trim());
  };
  return (
    <Modal
      open
      size="sm"
      zIndex={DIALOG_Z}
      {...titleProps(spec.title)}
      onClose={() => onDone(null)}
      onCancel={() => onDone(null)}
      onConfirm={submit}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onDone(null)}>
            {spec.cancelLabel ?? "Cancel"}
          </Button>
          <Button variant="primary" size="sm" disabled={error !== null} onClick={submit}>
            {spec.confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
        {spec.message != null && <div>{spec.message}</div>}
        <Input
          size="md"
          value={value}
          placeholder={spec.placeholder}
          invalid={error !== null && value !== ""}
          aria-invalid={error !== null}
          aria-label={spec.placeholder ?? spec.title}
          onChange={(e) => setValue(e.target.value)}
        />
        {error !== null && (
          <div aria-live="polite" style={{ fontSize: fontSize.sm, color: colors.dangerText }}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
