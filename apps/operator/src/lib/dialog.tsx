"use client";

import type { ReactNode } from "react";
import { alertDialog, confirm as confirmDialog, prompt as promptDialog } from "@overlaysys/ui";

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
  /** Default true: an empty name can't be submitted. Pass false to allow "". */
  required?: boolean;
  validate?(v: string): string | null;
};

const confirm = (o: ConfirmOpts) =>
  confirmDialog({
    title: o.title ?? "",
    message: o.message,
    confirmLabel: o.confirmLabel ?? "Confirm",
    cancelLabel: o.cancelLabel,
    danger: o.destructive,
  });

const alert = (o: AlertOpts) => alertDialog({ title: o.title ?? "", message: o.message, okLabel: o.okLabel });

const prompt = (o: PromptOpts) =>
  promptDialog({
    title: o.title ?? "",
    message: o.message,
    defaultValue: o.defaultValue,
    placeholder: o.placeholder,
    confirmLabel: o.confirmLabel ?? "OK",
    cancelLabel: o.cancelLabel,
    required: o.required ?? true,
    validate: o.validate,
  });

const api = { confirm, alert, prompt, dialog: null as ReactNode };

/**
 * Legacy hook kept for its call sites. Dialogs now render in the app-wide
 * `<DialogHost />` (root layout), so `dialog` is always null — rendering it is
 * a harmless no-op. New code imports `confirm` / `prompt` / `alertDialog`
 * from `@overlaysys/ui` directly.
 */
export function useDialog() {
  return api;
}
