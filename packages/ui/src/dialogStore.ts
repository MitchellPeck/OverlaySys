// Pure FIFO queue behind the app's dialogs (confirm / prompt / choose /
// alert). One dialog is visible at a time; resolving it settles its promise
// and shows the next. No React, no DOM — unit-tested in node.

import type { ReactNode } from "react";
import type { ButtonVariant } from "./buttonStyles";

export type ConfirmOptions = {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  danger?: boolean;
  /** Focus the confirm button on open, so Enter confirms (default: Cancel). */
  enterConfirms?: boolean;
};

export type PromptOptions = {
  title: string;
  message?: ReactNode;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  required?: boolean;
  /** Returns an error message, or null when the value is acceptable. */
  validate?(v: string): string | null;
};

export type ChooseActionOptions = {
  title: string;
  message: ReactNode;
  actions: { id: string; label: string; variant?: ButtonVariant }[];
  /** Resolved on Esc / backdrop click. */
  cancelId: string;
};

export type AlertOptions = { title: string; message: ReactNode; okLabel?: string };

export type DialogSpec =
  | ({ kind: "confirm" } & ConfirmOptions)
  | ({ kind: "prompt" } & PromptOptions)
  | ({ kind: "choose" } & ChooseActionOptions)
  | ({ kind: "alert" } & AlertOptions);

export type ActiveDialog = { id: number; spec: DialogSpec };

type Entry = ActiveDialog & { settle(value: unknown): void };

export type DialogStore = {
  /** Queue a dialog. Resolving with `undefined` settles it with `fallback`. */
  open<R>(spec: DialogSpec, fallback: R): Promise<R>;
  current(): ActiveDialog | null;
  /** Settle the visible dialog and show the next one. No-op when none is open. */
  resolve(value: unknown): void;
  subscribe(fn: () => void): () => void;
};

export function createDialogStore(): DialogStore {
  const queue: Entry[] = [];
  const listeners = new Set<() => void>();
  let nextId = 1;
  const notify = () => {
    for (const fn of [...listeners]) fn();
  };

  return {
    open<R>(spec: DialogSpec, fallback: R): Promise<R> {
      return new Promise<R>((res) => {
        queue.push({
          id: nextId++,
          spec,
          settle: (value) => res(value === undefined ? fallback : (value as R)),
        });
        notify();
      });
    },
    current() {
      return queue[0] ?? null;
    },
    resolve(value) {
      const head = queue.shift();
      if (!head) return;
      head.settle(value);
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
