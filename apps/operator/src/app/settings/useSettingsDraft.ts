"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { toast, type SaveBarProps } from "@overlaysys/ui";
import { ackErrorText } from "@/lib/awaitAck";
import { deepEqual } from "@/lib/diffEntity";
import { useConnection } from "@/lib/useConnection";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { draftReducer, isDirty, saveBarProps, type DraftAction, type DraftState } from "./settingsDraft";

export type SettingsBar = SaveBarProps;

export type UseSettingsDraftOpts<T> = {
  load(): Promise<T>;
  save(v: T): Promise<T>;
  equal?(a: T, b: T): boolean;
  validate?(v: T): string | null;
  /** Needs the server connection to save (default true). */
  needsServer?: boolean;
};

export function useSettingsDraft<T>(opts: UseSettingsDraftOpts<T>): {
  value: T | null;
  set(v: T | ((p: T) => T)): void;
  bar: SettingsBar;
  error: string | null;
  /** True when the saved value changed remotely while the draft had unsaved edits. */
  changedElsewhere: boolean;
  loading: boolean;
  reload(): void;
} {
  const { connected } = useConnection();
  const equal = opts.equal ?? deepEqual;
  const init: DraftState<T> = { saved: null, draft: null, saving: false, error: null };
  const [state, dispatch] = useReducer(
    (s: DraftState<T>, a: DraftAction<T>) => draftReducer<T>(s, a),
    init,
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    optsRef.current
      .load()
      .then((v) => {
        if (alive) dispatch({ type: "loaded", value: v });
      })
      .catch((e) => {
        if (alive) setLoadError(ackErrorText(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [nonce]);

  const set = useCallback((v: T | ((p: T) => T)) => {
    if (typeof v === "function") dispatch({ type: "update", fn: v as (p: T) => T });
    else dispatch({ type: "edit", value: v });
  }, []);

  const invalidReason = state.draft !== null && opts.validate ? opts.validate(state.draft) : null;
  const dirty = isDirty(state, equal);

  const onSave = useCallback(async (): Promise<boolean> => {
    const { draft, saving } = stateRef.current;
    if (draft === null || saving) return false;
    const bad = optsRef.current.validate?.(draft) ?? null;
    if (bad) {
      dispatch({ type: "saveFail", error: bad });
      toast({ tone: "error", message: `Not saved: ${bad}` });
      return false;
    }
    dispatch({ type: "saveStart" });
    try {
      const saved = await optsRef.current.save(draft);
      dispatch({ type: "saveOk", value: saved });
      toast({ tone: "ok", message: "Saved" });
      return true;
    } catch (e) {
      const text = ackErrorText(e);
      dispatch({ type: "saveFail", error: text });
      toast({ tone: "error", message: `Not saved: ${text}` });
      return false;
    }
  }, []);

  const onRevert = useCallback(() => dispatch({ type: "revert" }), []);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useUnsavedGuard(dirty, { onSave });

  const sb = saveBarProps(state, {
    connected: opts.needsServer === false ? true : connected,
    equal,
    invalidReason,
  });
  const bar = useMemo<SettingsBar>(
    () => ({
      dirty: sb.dirty,
      saving: sb.saving,
      ...(sb.disabledReason ? { disabledReason: sb.disabledReason } : {}),
      onSave: () => void onSave(),
      onRevert,
    }),
    [sb.dirty, sb.saving, sb.disabledReason, onSave, onRevert],
  );

  return { value: state.draft, set, bar, error: state.error ?? loadError, changedElsewhere: !!state.changedElsewhere, loading, reload };
}
