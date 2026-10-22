"use client";

import { useEffect, useState } from "react";
import { Button, Panel, colors } from "@overlaysys/ui";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { ScriptureIntroEditor, type IntroConfig } from "@/app/components/ScriptureIntroEditor";
import { setScriptureSettingsCache } from "@/lib/scriptureSettings";
import {
  getApiBibleStatus,
  getScriptureSettings,
  putScriptureSettings,
  removeApiBibleKey,
  saveApiBibleKey,
  type ApiBibleStatus,
} from "@/lib/scriptureClient";

const STATE_LABEL: Record<ApiBibleStatus["state"], string> = {
  ok: "NIV found ✓",
  no_key: "No key set",
  rejected: "Key rejected",
  no_niv: "Key works but no NIV",
  offline: "Can't reach API.Bible",
};

export default function ScriptureSettingsPage() {
  const [status, setStatus] = useState<ApiBibleStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getApiBibleStatus().then(setStatus).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const fromEnv = status?.source === "env";

  async function run(action: () => Promise<ApiBibleStatus>) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
      setKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageChrome title="Scripture" />
      <PageBody maxWidth={720}>
        <Panel title="API.Bible (NIV)">
          <p style={{ color: colors.textDim, fontSize: 13, marginTop: 0 }}>
            Your API.Bible key unlocks the NIV in the scripture picker. It is stored on this
            machine only.
          </p>
          <p role="status" style={{ fontSize: 13, color: status?.state === "ok" ? colors.ok : colors.textDim }}>
            {status ? STATE_LABEL[status.state] : "Loading…"}
            {fromEnv ? " · Set by environment (OVERLAYSYS_API_BIBLE_KEY)" : ""}
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="password"
              aria-label="API.Bible key"
              placeholder={status?.configured ? "Enter a new key to replace it" : "API.Bible key"}
              value={key}
              disabled={fromEnv || busy}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              style={{
                flex: 1,
                padding: "6px 10px",
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: colors.text,
              }}
            />
            <Button
              variant="primary"
              disabled={fromEnv || busy || key.trim().length === 0}
              onClick={() => void run(() => saveApiBibleKey(key.trim()))}
            >
              {busy ? "Checking…" : "Save"}
            </Button>
            {status?.configured && !fromEnv && (
              <Button variant="ghost" disabled={busy} onClick={() => void run(removeApiBibleKey)}>
                Remove
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" style={{ color: colors.errorText, fontSize: 12 }}>
              {error}
            </p>
          )}
        </Panel>
        <DefaultIntroPanel />
      </PageBody>
    </>
  );
}

function DefaultIntroPanel() {
  const [draft, setDraft] = useState<IntroConfig | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getScriptureSettings()
      .then((s) => setDraft(s))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function save() {
    if (!draft) return;
    setError(null);
    try {
      const s = await putScriptureSettings(draft);
      setScriptureSettingsCache(s);
      setSaved("Saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Panel title="Default scripture intro">
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
