"use client";

import { useEffect, useState } from "react";
import type { SttSpawnerConfig } from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { AppHeader } from "@/app/components/AppHeader";

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
      <>
        <AppHeader />
        <div style={{ padding: 24 }}>Loading...</div>
      </>
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
  const stateColor: Record<string, string> = {
    idle: "var(--text-dim)",
    starting: "#fbbf24",
    running: "#4ade80",
    stopped: "var(--text-dim)",
    error: "#ef4444",
  };

  return (
    <>
      <AppHeader
        context={<h1 style={{ margin: 0, fontSize: 16 }}>STT Spawner</h1>}
        actions={
          <>
            <span
              style={{
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: 999,
                border: `1px solid ${stateColor[state]}`,
                color: stateColor[state],
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {state}
            </span>
            {state === "running" || state === "starting" ? (
              <button onClick={stop} style={btn("danger")}>
                Stop
              </button>
            ) : (
              <button onClick={start} style={btn("primary")}>
                Start
              </button>
            )}
          </>
        }
      />
      <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
        <fieldset
          style={{
            marginBottom: 16,
            padding: 16,
            border: "1px solid var(--border)",
            borderRadius: 4,
          }}
        >
          <legend style={{ fontSize: 12, color: "var(--text-dim)" }}>Configuration</legend>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
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
          <label
            style={{
              display: "block",
              fontSize: 12,
              color: "var(--text-dim)",
              marginBottom: 4,
            }}
          >
            Command (stdout is piped into the lyric-listener daemon)
          </label>
          <textarea
            value={draft.command}
            onChange={(e) => setDraft({ ...draft, command: e.target.value })}
            rows={3}
            style={{
              width: "100%",
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              padding: 8,
              boxSizing: "border-box",
            }}
          />
          <p style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }}>
            Examples:
            <br />
            <code
              style={{ background: "var(--panel-2)", padding: "1px 4px", borderRadius: 2 }}
            >
              whisper-stream -m ~/whisper-models/ggml-base.en.bin --step 500 --length 5000
            </code>
            <br />
            <code
              style={{ background: "var(--panel-2)", padding: "1px 4px", borderRadius: 2 }}
            >
              whisper-stream -m ~/whisper-models/ggml-small.en.bin -c 1 --step 500 --length 4000
            </code>
          </p>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button onClick={save} style={btn()}>
              Save Config
            </button>
          </div>
        </fieldset>

        <fieldset
          style={{ padding: 16, border: "1px solid var(--border)", borderRadius: 4 }}
        >
          <legend style={{ fontSize: 12, color: "var(--text-dim)" }}>
            Recent logs {status?.pid ? `(pid ${status.pid})` : ""}
          </legend>
          {status?.lastError && (
            <div
              style={{
                padding: 8,
                marginBottom: 8,
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: 4,
                fontSize: 12,
                color: "#ef4444",
              }}
            >
              {status.lastError}
            </div>
          )}
          <pre
            style={{
              background: "var(--panel-2)",
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
        </fieldset>
      </div>
    </>
  );
}

function btn(kind: "default" | "primary" | "danger" = "default"): React.CSSProperties {
  const colors = {
    default: { bg: "var(--panel-2)", fg: "var(--text)" },
    primary: { bg: "var(--accent)", fg: "#fff" },
    danger: { bg: "#ef4444", fg: "#fff" },
  }[kind];
  return {
    padding: "6px 12px",
    background: colors.bg,
    color: colors.fg,
    border: "1px solid var(--border)",
    borderRadius: 4,
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 12,
  };
}
