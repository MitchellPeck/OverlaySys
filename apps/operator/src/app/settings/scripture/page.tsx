"use client";

import { useEffect, useState } from "react";
import { Button, Field, Input, Panel, Select, colors } from "@overlaysys/ui";
import type { TranslationMeta } from "@overlaysys/scripture";
import { useDialog } from "@/lib/dialog";
import { useStore } from "@/lib/store";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { ScriptureIntroEditor, type IntroConfig } from "@/app/components/ScriptureIntroEditor";
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

export default function ScriptureSettingsPage() {
  const [status, setStatus] = useState<ApiBibleStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped whenever the translation list may have changed. */
  const [translationsRev, setTranslationsRev] = useState(0);
  const { confirm, dialog } = useDialog();

  useEffect(() => {
    getApiBibleStatus().then(setStatus).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const fromEnv = status?.source === "env";
  const keyUsable = status?.configured && (status.state === "ok" || status.state === "no_niv");

  async function run(action: () => Promise<ApiBibleStatus>) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
      setKey("");
      setTranslationsRev((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    const ok = await confirm({
      title: "Remove API.Bible key?",
      message:
        "NIV and any other API.Bible translations disappear from the scripture picker. " +
        "Scripture rows already in shows keep their text but stop being refreshed.",
      confirmLabel: "Remove key",
      destructive: true,
    });
    if (ok) await run(removeApiBibleKey);
  }

  return (
    <>
      <PageChrome title="Scripture" />
      <PageBody maxWidth={720}>
        <Panel title="API.Bible">
          <p style={{ color: colors.textDim, fontSize: 13, marginTop: 0 }}>
            Your API.Bible key unlocks licensed translations (NIV by default) in the scripture
            picker. It is stored on this machine only.
          </p>
          <p role="status" style={{ fontSize: 13, color: status?.state === "ok" ? colors.ok : colors.textDim }}>
            {status ? statusLine(status) : "Loading…"}
            {fromEnv ? " · Set by environment (OVERLAYSYS_API_BIBLE_KEY)" : ""}
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Input
              type="password"
              size="md"
              aria-label="API.Bible key"
              placeholder={status?.configured ? "Enter a new key to replace it" : "API.Bible key"}
              value={key}
              disabled={fromEnv || busy}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              style={{ flex: 1 }}
            />
            <Button
              variant="primary"
              disabled={fromEnv || busy || key.trim().length === 0}
              onClick={() => void run(() => saveApiBibleKey(key.trim()))}
            >
              {busy ? "Checking…" : "Save"}
            </Button>
            {status?.configured && !fromEnv && (
              <Button variant="ghost" disabled={busy} onClick={() => void removeKey()}>
                Remove
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" style={{ color: colors.errorText, fontSize: 12 }}>
              {error}
            </p>
          )}
          {keyUsable && status && (
            <TranslationPicker
              status={status}
              onSaved={(s) => {
                setStatus(s);
                setTranslationsRev((n) => n + 1);
              }}
            />
          )}
        </Panel>
        <DefaultTranslationPanel rev={translationsRev} />
        <DefaultIntroPanel />
      </PageBody>
      {dialog}
    </>
  );
}

/** Choose which of the key's licensed Bibles appear in the scripture picker. */
function TranslationPicker({
  status,
  onSaved,
}: {
  status: ApiBibleStatus;
  onSaved: (s: ApiBibleStatus) => void;
}) {
  const [bibles, setBibles] = useState<ApiBibleSummary[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(status.translations?.map((t) => t.bibleId) ?? []),
  );
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listApiBibles()
      .then((b) => !cancelled && setBibles(b))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const q = filter.trim().toLowerCase();
  const shown = (bibles ?? []).filter(
    (b) =>
      !q ||
      picked.has(b.bibleId) ||
      `${b.abbreviation} ${b.name} ${b.language} ${b.languageName ?? ""}`.toLowerCase().includes(q),
  );

  async function save() {
    setSaving(true);
    setError(null);
    try {
      onSaved(await saveApiBibleTranslations([...picked]));
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 16, borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
      <h3 style={{ fontSize: 14, margin: "0 0 4px" }}>Translations</h3>
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
              <label key={b.bibleId} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "2px 0" }}>
                <input
                  type="checkbox"
                  checked={picked.has(b.bibleId)}
                  onChange={(e) => {
                    setSaved(false);
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(b.bibleId);
                      else next.delete(b.bibleId);
                      return next;
                    });
                  }}
                />
                <strong style={{ minWidth: 64 }}>{b.abbreviation}</strong>
                <span>{b.name}</span>
                <span style={{ color: colors.textDim, marginLeft: "auto" }}>{b.languageName ?? b.language}</span>
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : `Use ${picked.size} translation${picked.size === 1 ? "" : "s"}`}
            </Button>
            {saved && <span style={{ fontSize: 12, color: colors.ok }}>Saved</span>}
          </div>
        </>
      )}
      {error && <p role="alert" style={{ color: colors.errorText, fontSize: 12 }}>{error}</p>}
    </div>
  );
}

/** Install-wide default translation: listed first, so pickers start on it. */
function DefaultTranslationPanel({ rev }: { rev: number }) {
  const [translations, setTranslations] = useState<TranslationMeta[] | null>(null);
  const [value, setValue] = useState("");
  const [stored, setStored] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTranslationsWithDefault()
      .then((r) => {
        if (cancelled) return;
        setTranslations(r.translations);
        setValue(r.defaultTranslation ?? "");
        setStored(r.storedDefault);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [rev]);

  async function choose(id: string) {
    setValue(id);
    setSaved(false);
    setError(null);
    try {
      await putDefaultTranslation(id || null);
      setStored(id || null);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Panel title="Default translation">
      <Field label="Translation">
        <Select value={value} disabled={!translations} onChange={(e) => void choose(e.target.value)}>
          <option value="">— First available —</option>
          {(translations ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.abbreviation} — {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <p style={{ color: colors.textDim, fontSize: 13 }}>
        Pre-selected when you add a scripture row. Each row keeps its own translation.
        {stored && !value && ` (${stored} is no longer available.)`}
      </p>
      {saved && <span style={{ fontSize: 12, color: colors.ok }}>Saved</span>}
      {error && <p role="alert" style={{ color: colors.errorText, fontSize: 12 }}>{error}</p>}
    </Panel>
  );
}

function DefaultIntroPanel() {
  const templates = useStore((s) => s.templates);
  const [draft, setDraft] = useState<IntroConfig | null>(null);
  // Kept apart from `draft`: the intro editor replaces its whole value on a
  // template change, which would otherwise drop this field.
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getScriptureSettings()
      .then((s) => {
        setDraft(s);
        setDefaultTemplateId(s.defaultTemplateId);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function save() {
    if (!draft) return;
    setError(null);
    try {
      const s = await putScriptureSettings({ ...draft, defaultTemplateId });
      setScriptureSettingsCache(s);
      setSaved("Saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Panel title="Scripture defaults">
      <Field label="Default scripture template">
        <Select
          value={defaultTemplateId ?? ""}
          disabled={!draft}
          onChange={(e) => {
            setDefaultTemplateId(e.target.value || undefined);
            setSaved(null);
          }}
        >
          <option value="">— First template —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      </Field>
      <p style={{ color: colors.textDim, fontSize: 13 }}>
        Pre-selected when you add a scripture row. Each row keeps its own template.
      </p>
      <h3 style={{ fontSize: 14, margin: "16px 0 4px" }}>Default intro</h3>
      <p style={{ color: colors.textDim, fontSize: 13, marginTop: 0 }}>
        Used by every scripture row unless the row sets its own intro or skips it.
      </p>
      {draft ? (
        <ScriptureIntroEditor value={draft} onChange={(n) => { setDraft(n); setSaved(null); }} />
      ) : (
        <p>Loading…</p>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <Button variant="primary" disabled={!draft} onClick={() => void save()}>Save</Button>
        {saved && <span style={{ fontSize: 12, color: colors.ok }}>{saved}</span>}
      </div>
      {error && <p role="alert" style={{ color: colors.errorText, fontSize: 12 }}>{error}</p>}
    </Panel>
  );
}
