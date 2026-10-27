"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Input, Panel, colors } from "@overlaysys/ui";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { getStageSettings, putStageSettings } from "@/lib/stageSettingsClient";

export default function StageSettingsPage() {
  const [presets, setPresets] = useState<string[] | null>(null);
  const [autoItemTimer, setAutoItemTimer] = useState(true);
  const [itemTimerOvertime, setItemTimerOvertime] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStageSettings()
      .then((s) => {
        setPresets(s.messagePresets);
        setAutoItemTimer(s.autoItemTimer);
        setItemTimerOvertime(s.itemTimerOvertime);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  function edit(i: number, v: string) {
    setPresets((p) => p && p.map((x, j) => (j === i ? v : x)));
  }
  function move(i: number, d: number) {
    setPresets((p) => {
      if (!p || i + d < 0 || i + d >= p.length) return p;
      const n = [...p];
      [n[i], n[i + d]] = [n[i + d]!, n[i]!];
      return n;
    });
  }

  async function save() {
    if (!presets) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const saved = await putStageSettings({ messagePresets: presets, autoItemTimer, itemTimerOvertime });
      setPresets(saved.messagePresets);
      setAutoItemTimer(saved.autoItemTimer);
      setItemTimerOvertime(saved.itemTimerOvertime);
      setStatus("Saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageChrome title="Stage monitor" />
      <PageBody maxWidth={720}>
        <p style={{ color: colors.textDim, fontSize: 13, marginTop: 0 }}>
          Stage monitors are configured in{" "}
          <Link href="/settings/channels" style={{ color: colors.brand }}>
            Settings → Channels
          </Link>
          . Pastors control notes from Companion&apos;s &quot;Pastor Notes&quot; page.
        </p>
        <Panel title="Message presets">
          {presets === null ? (
            <div style={{ color: colors.textDim, fontSize: 13 }}>{error ?? "Loading…"}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {presets.map((p, i) => (
                <div key={i} style={{ display: "flex", gap: 4 }}>
                  <Input value={p} maxLength={200} onChange={(e) => edit(i, e.target.value)} />
                  <Button disabled={i === 0} title="Move up" onClick={() => move(i, -1)}>
                    ↑
                  </Button>
                  <Button disabled={i === presets.length - 1} title="Move down" onClick={() => move(i, 1)}>
                    ↓
                  </Button>
                  <Button title="Remove" onClick={() => setPresets(presets.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </div>
              ))}
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginTop: 8 }}>
                <input type="checkbox" checked={autoItemTimer} onChange={(e) => setAutoItemTimer(e.target.checked)} />
                Start item countdown when a row with a length is taken
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={itemTimerOvertime}
                  onChange={(e) => setItemTimerOvertime(e.target.checked)}
                />
                Item countdown runs into overtime
              </label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Button onClick={() => setPresets([...presets, ""])}>Add preset</Button>
                <Button variant="primary" disabled={busy} onClick={save}>
                  Save
                </Button>
                {status && <span style={{ color: colors.ok, fontSize: 12 }}>{status}</span>}
                {error && <span style={{ color: colors.danger, fontSize: 12 }}>{error}</span>}
              </div>
            </div>
          )}
        </Panel>
      </PageBody>
    </>
  );
}
