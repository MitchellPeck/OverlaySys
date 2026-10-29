"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Field, Input, Panel, SaveBar, Select, colors } from "@overlaysys/ui";
import type { ScriptureSettings } from "@overlaysys/core";
import type { TranslationMeta } from "@overlaysys/scripture";
import { useConfirm } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { ScriptureIntroEditor } from "@/app/components/ScriptureIntroEditor";
import { setScriptureSettingsCache } from "@/lib/scriptureSettings";
import {
  getApiBibleStatus,
  getScriptureSettings,
  getTranslationsWithDefault,
  listApiBibles,
  putDefaultTranslation,
  putScriptureSettings,
  removeApiBibleKey,
  saveApiBibleKey,
  saveApiBibleTranslations,
  type ApiBibleStatus,
  type ApiBibleSummary,
} from "@/lib/scriptureClient";
import { useSettingsDraft } from "../useSettingsDraft";

const STATE_LABEL: Record<ApiBibleStatus["state"], string> = {
  ok: "Key works ✓",
  no_key: "No key set",
  rejected: "Key rejected",
  no_niv: "Key works but has no NIV — pick translations below",
  offline: "Can't reach API.Bible",
};

function statusLine(status: ApiBibleStatus): string {
  const base = STATE_LABEL[status.state];
  if (status.state !== "ok") return base;
  const names = status.translations?.map((t) => t.abbreviation) ?? [];
  if (names.length === 0) return `${base} · no translations enabled`;
  return `${base} · ${names.join(", ")}`;
}

/** Everything on this page that saves together. */
type ScriptureDraft = {
  /** New API key to verify and store; empty = leave the stored key alone. */
  key: string;
  /** Registered API.Bible Bible ids. */
  picked: string[];
  /** Install-wide default translation id ("" = first available). */
  defaultTranslation: string;
  settings: ScriptureSettings;
};

type Extras = { status: ApiBibleStatus; translations: TranslationMeta[]; storedDefault: string | null };

export default function ScriptureSettingsPage() {
  const confirm = useConfirm();
  const [extras, setExtras] = useState<Extras | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  /** The values last read from / written to the server, to save only what changed. */
  const baseline = useRef<ScriptureDraft | null>(null);
  const templates = useStore((s) => s.templates);

  async function fetchAll(): Promise<ScriptureDraft> {
    const [status, settings, tr] = await Promise.all([
      getApiBibleStatus(),
      getScriptureSettings(),
      getTranslationsWithDefault(),
    ]);
    setExtras({ status, translations: tr.translations, storedDefault: tr.storedDefault });
    const d: ScriptureDraft = {
      key: "",
      picked: (status.translations ?? []).map((t) => t.bibleId),
      defaultTranslation: tr.defaultTranslation ?? "",
      settings,
    };
    baseline.current = d;
    return d;
  }

  const { value, set, bar, error, loading, reload } = useSettingsDraft<ScriptureDraft>({
    load: fetchAll,
    async save(v) {
      const base = baseline.current;
      if (v.key.trim()) {
        const s = await saveApiBibleKey(v.key.trim());
        if (s.state !== "ok" && s.state !== "no_niv") throw new Error(s.message ?? statusLine(s));
      }
      const samePicked = base && v.picked.length === base.picked.length && v.picked.every((p) => base.picked.includes(p));
      if (!samePicked) await saveApiBibleTranslations(v.picked);
      if (!base || v.defaultTranslation !== base.defaultTranslation) {
        await putDefaultTranslation(v.defaultTranslation || null);
      }
      if (!base || JSON.stringify(v.settings) !== JSON.stringify(base.settings)) {
        const s = await putScriptureSettings(v.settings);
        setScriptureSettingsCache(s);
      }
      return fetchAll();
    },
  });

  async function removeKey() {
    const ok = await confirm({
      title: "Remove API.Bible key?",
      message:
        "NIV and any other API.Bible translations disappear from the scripture picker. " +
        "Scripture rows already in shows keep their text but stop being refreshed.",
      confirmLabel: "Remove key",
      danger: true,
    });
    if (!ok) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await removeApiBibleKey();
      reload();
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(false);
    }
  }

  const status = extras?.status ?? null;
  const fromEnv = status?.source === "env";
  const keyUsable = !!status?.configured && (status.state === "ok" || status.state === "no_niv");
  const saving = bar.saving;

  return (
    <>
      <PageChrome title="Scripture" actions={<SaveBar {...bar} />} />
      <PageBody variant="form">
        {error && (
          <p role="alert" style={{ color: colors.errorText, fontSize: 12, margin: 0 }}>
            {error}
          </p>
        )}
        <Panel title="API.Bible">
          <p style={{ color: colors.textDim, fontSize: 13, marginTop: 0 }}>
            Your API.Bible key unlocks licensed translations (NIV by default) in the scripture
            picker. It is stored on this machine only.
          </p>
          <p role="status" style={{ fontSize: 13, color: status?.state === "ok" ? colors.ok : colors.textDim }}>
            {status ? statusLine(status) : loading ? "Loading…" : "Status unavailable"}
            {fromEnv ? " · Set by environment (OVERLAYSYS_API_BIBLE_KEY)" : ""}
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Input
              type="password"
              size="md"
              aria-label="API.Bible key"
              placeholder={status?.configured ? "Enter a new key to replace it" : "API.Bible key"}
              value={value?.key ?? ""}
              disabled={fromEnv || !value || saving}
              onChange={(e) => set((p) => ({ ...p, key: e.target.value }))}
              autoComplete="off"
              style={{ flex: 1 }}
            />
            {status?.configured && !fromEnv && (
              <Button variant="danger" disabled={removing || saving} onClick={() => void removeKey()}>
                Remove key
              </Button>
            )}
          </div>
          {removeError && (
            <p role="alert" style={{ color: colors.errorText, fontSize: 12 }}>
              {removeError}
            </p>
          )}
          {keyUsable && status && value && (
            <TranslationPicker
              status={status}
              picked={value.picked}
              onPick={(picked) => set((p) => ({ ...p, picked }))}
            />
          )}
        </Panel>

        <Panel title="Default translation">
          <Field label="Translation">
            <Select
              value={value?.defaultTranslation ?? ""}
              disabled={!value || !extras}
              onChange={(e) => set((p) => ({ ...p, defaultTranslation: e.target.value }))}
            >
              <option value="">— First available —</option>
              {(extras?.translations ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.abbreviation} — {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <p style={{ color: colors.textDim, fontSize: 13 }}>
            Pre-selected when you add a scripture row. Each row keeps its own translation.
            {extras?.storedDefault && !value?.defaultTranslation && ` (${extras.storedDefault} is no longer available.)`}
          </p>
        </Panel>

        <Panel title="Scripture defaults">
          <Field label="Default scripture template">
            <Select
              value={value?.settings.defaultTemplateId ?? ""}
              disabled={!value}
              onChange={(e) =>
                set((p) => ({
                  ...p,
                  settings: { ...p.settings, defaultTemplateId: e.target.value || undefined },
                }))
              }
            >
              <option value="">— First template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <p style={{ color: colors.textDim, fontSize: 13, marginBottom: 0 }}>
            Pre-selected when you add a scripture row. Each row keeps its own template.
          </p>
        </Panel>

        <Panel title="Default intro">
          <p style={{ color: colors.textDim, fontSize: 13, marginTop: 0 }}>
            Used by every scripture row unless the row sets its own intro or skips it.
          </p>
          {value ? (
            <ScriptureIntroEditor
              value={value.settings}
              // The intro editor replaces its whole value; keep the template default.
              onChange={(n) =>
                set((p) => ({
                  ...p,
                  settings: { ...n, defaultTemplateId: p.settings.defaultTemplateId },
                }))
              }
            />
          ) : (
            <p style={{ fontSize: 13, color: colors.textDim }}>{loading ? "Loading…" : "Unavailable"}</p>
          )}
        </Panel>
      </PageBody>
    </>
  );
}

/** Choose which of the key's licensed Bibles appear in the scripture picker. */
function TranslationPicker({
  status,
  picked,
  onPick,
}: {
  status: ApiBibleStatus;
  picked: string[];
  onPick: (next: string[]) => void;
}) {
  const [bibles, setBibles] = useState<ApiBibleSummary[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listApiBibles()
      .then((b) => !cancelled && setBibles(b))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const pickedSet = new Set(picked);
  const q = filter.trim().toLowerCase();
  const shown = (bibles ?? []).filter(
    (b) =>
      !q ||
      pickedSet.has(b.bibleId) ||
      `${b.abbreviation} ${b.name} ${b.language} ${b.languageName ?? ""}`.toLowerCase().includes(q),
  );

  function toggle(id: string, on: boolean) {
    const next = new Set(pickedSet);
    if (on) next.add(id);
    else next.delete(id);
    onPick([...next]);
  }

  return (
    <div style={{ marginTop: 16, borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
      <h3 style={{ fontSize: 13, margin: "0 0 4px" }}>Translations</h3>
      <p style={{ color: colors.textDim, fontSize: 13, marginTop: 0 }}>
        Pick the translations your key licenses that should appear in the scripture picker.
        {status.selection !== "custom" && " Until you save a choice, only the NIV is used."}
      </p>
      {!bibles && !error && <p style={{ fontSize: 13, color: colors.textDim }}>Loading translations…</p>}
      {bibles && (
        <>
          <Input
            type="search"
            aria-label="Filter translations"
            placeholder="Filter by name, abbreviation or language…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <div
            role="group"
            aria-label="API.Bible translations"
            style={{ maxHeight: 260, overflow: "auto", border: `1px solid ${colors.border}`, borderRadius: 6, padding: 8 }}
          >
            {shown.length === 0 && <p style={{ fontSize: 13, color: colors.textDim, margin: 0 }}>No matches.</p>}
            {shown.map((b) => (
              <div key={b.bibleId} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "2px 0" }}>
                <Checkbox
                  checked={pickedSet.has(b.bibleId)}
                  onChange={(on) => toggle(b.bibleId, on)}
                  aria-label={`${b.abbreviation} — ${b.name}`}
                  label={
                    <span style={{ display: "inline-flex", gap: 8 }}>
                      <strong style={{ minWidth: 64 }}>{b.abbreviation}</strong>
                      <span>{b.name}</span>
                    </span>
                  }
                />
                <span style={{ color: colors.textDim, marginLeft: "auto" }}>{b.languageName ?? b.language}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: colors.textDim, marginBottom: 0 }}>
            {picked.length} translation{picked.length === 1 ? "" : "s"} selected. Save to apply.
          </p>
        </>
      )}
      {error && <p role="alert" style={{ color: colors.errorText, fontSize: 12 }}>{error}</p>}
    </div>
  );
}
