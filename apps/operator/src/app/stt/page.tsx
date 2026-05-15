"use client";

import { useEffect, useState } from "react";
import type { SttSpawnerConfig } from "@overlaysys/core";
import { Button, Panel, Pill, Textarea, colors, type PillTone } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { AppHeader } from "@/app/components/AppHeader";
import { PageShell, PageBody } from "@/app/components/PageShell";

const STATE_TONES: Record<string, PillTone> = {
  idle: "dim",
  starting: "warn",
  running: "good",
  stopped: "dim",
  error: "bad",
};

export default function SttControlPage() {
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const status = useStore((s) => s.sttSpawnerStatus);
  const config = useStore((s) => s.sttSpawnerConfig);
  const [draft, setDraft] = useState<SttSpawnerConfig | null>(null);

  useEffect(() => {
    if (conn === "open") send({ type: "stt_spawner_get_config" });
  }, [conn, send]);

  useEffect(() => {
    if (config && !draft) setDraft(config);
  }, [config, draft]);

  if (!draft) {
    return (
      <PageShell>
        <AppHeader />
        <PageBody>Loading...</PageBody>
      </PageShell>
    );
  }

  function save() {
    if (!draft) return;
    send({ type: "stt_spawner_save_config", config: draft });
  }
  function start() {
    save();
    send({ type: "stt_spawner_start" });
  }
  function stop() {
    send({ type: "stt_spawner_stop" });
  }

  const state = status?.state ?? "idle";
  const tone = STATE_TONES[state] ?? "dim";

  return (
    <PageShell>
      <AppHeader
        title="STT Spawner"
        actions={
          <>
            <Pill tone={tone} uppercase>
              {state}
            </Pill>
            {state === "running" || state === "starting" ? (
              <Button onClick={stop} variant="destructive" size="sm">
                Stop
              </Button>
            ) : (
              <Button onClick={start} variant="primary" size="sm">
                Start
              </Button>
            )}
          </>
        }
      />
      <PageBody maxWidth={1000}>
        <Panel title="Configuration" padding="md" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <input
              type="checkbox"
              id="autoStart"
              checked={draft.autoStart}
              onChange={(e) => setDraft({ ...draft, autoStart: e.target.checked })}
            />
            <label htmlFor="autoStart" style={{ fontSize: 13 }}>
              Auto-start on server boot
            </label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <input
              type="checkbox"
              id="biasOnSongStart"
              checked={draft.biasOnSongStart}
              onChange={(e) =>
                setDraft({ ...draft, biasOnSongStart: e.target.checked })
              }
            />
            <label htmlFor="biasOnSongStart" style={{ fontSize: 13 }}>
              Restart STT on program song change (bias)
            </label>
          </div>
          <p style={{ fontSize: 11, color: colors.textDim, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
            When enabled, the active program-channel song&apos;s lyrics are exposed to your
            command as the env var{" "}
            <code style={{ background: colors.panel2, padding: "1px 4px", borderRadius: 2 }}>
              $OVERLAYSYS_BIAS_PROMPT
            </code>
            . Whisper.cpp&apos;s{" "}
            <code style={{ background: colors.panel2, padding: "1px 4px", borderRadius: 2 }}>
              whisper-stream
            </code>{" "}
            does NOT support a prompt flag, so to actually use the bias you&apos;ll need a
            command that does — e.g.{" "}
            <code style={{ background: colors.panel2, padding: "1px 4px", borderRadius: 2 }}>
              whisper-cli --prompt &quot;$OVERLAYSYS_BIAS_PROMPT&quot;
            </code>{" "}
            wrapped in a streaming loop, or your own STT wrapper. With the box checked,
            the child is restarted on every song change so a fresh prompt is picked up.
          </p>
          <label
            style={{ display: "block", fontSize: 12, color: colors.textDim, marginBottom: 4 }}
          >
            Command (stdout is piped into the lyric-listener daemon)
          </label>
          <Textarea
            value={draft.command}
            onChange={(e) => setDraft({ ...draft, command: e.target.value })}
            rows={3}
            mono
          />
          <p style={{ fontSize: 11, color: colors.textDim, marginTop: 6 }}>
            Examples:
            <br />
            <code style={{ background: colors.panel2, padding: "1px 4px", borderRadius: 2 }}>
              whisper-stream -m ~/whisper-models/ggml-base.en.bin --step 500 --length 5000
            </code>
            <br />
            <code style={{ background: colors.panel2, padding: "1px 4px", borderRadius: 2 }}>
              whisper-stream -m ~/whisper-models/ggml-small.en.bin -c 1 --step 500 --length 4000
            </code>
          </p>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <Button onClick={save} size="sm">
              Save Config
            </Button>
          </div>
        </Panel>

        <Panel
          title={`Recent logs ${status?.pid ? `(pid ${status.pid})` : ""}`}
          padding="md"
        >
          {status?.lastError && (
            <div
              style={{
                padding: 8,
                marginBottom: 8,
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: 4,
                fontSize: 12,
                color: colors.errorText,
              }}
            >
              {status.lastError}
            </div>
          )}
          <pre
            style={{
              background: colors.panel2,
              padding: 12,
              borderRadius: 4,
              fontSize: 11,
              fontFamily: "ui-monospace, monospace",
              maxHeight: 400,
              overflow: "auto",
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {(status?.recentLogs ?? []).join("\n") || "(no logs yet)"}
          </pre>
        </Panel>
      </PageBody>
    </PageShell>
  );
}
