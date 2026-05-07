"use client";

import { useEffect, useRef, useState } from "react";
import type { ChannelConfig, ChannelRenderMode } from "@overlaysys/core";
import { useWs } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useDialog } from "@/lib/dialog";
import { AppHeader } from "@/app/components/AppHeader";

const BG_PRESETS: { label: string; value: string }[] = [
  { label: "transparent", value: "transparent" },
  { label: "black", value: "#000000" },
  { label: "chroma green", value: "#00ff00" },
  { label: "chroma blue", value: "#0000ff" },
];

export default function ChannelsPage() {
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const channels = useStore((s) => s.channelConfigs);
  const [creating, setCreating] = useState<{
    id: string;
    name: string;
    mirrorOf: string;
    renderMode: ChannelRenderMode;
  }>({ id: "", name: "", mirrorOf: "", renderMode: "normal" });
  const { confirm, alert, dialog } = useDialog();

  useEffect(() => {
    if (conn === "open") send({ type: "list_channels" });
  }, [conn, send]);

  function create() {
    const id = creating.id.trim();
    const name = creating.name.trim() || id;
    if (!id) return;
    if (channels.some((c) => c.id === id)) {
      void alert({
        title: "Duplicate channel",
        message: (
          <>
            A channel with id <strong>{id}</strong> already exists.
          </>
        ),
      });
      return;
    }
    const config: ChannelConfig = {
      id,
      name,
      renderMode: creating.renderMode,
      background: "transparent",
      ...(creating.mirrorOf ? { mirrorOf: creating.mirrorOf } : {}),
    };
    send({ type: "save_channel", config });
    setCreating({ id: "", name: "", mirrorOf: "", renderMode: "normal" });
  }

  function save(config: ChannelConfig) {
    send({ type: "save_channel", config });
  }

  async function remove(id: string, name: string) {
    const ok = await confirm({
      title: "Delete channel",
      message: (
        <>
          Delete <strong>{name}</strong>? This removes the JSON file.
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) send({ type: "delete_channel", channelId: id });
  }

  return (
    <>
      <AppHeader />
      <main style={{ padding: 24 }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>

        <p style={{ color: "var(--text-dim)", fontSize: 12, lineHeight: 1.5, marginBottom: 16 }}>
          Each channel is a renderer endpoint at <code>:3001/?channel=&lt;id&gt;</code>.{" "}
          <strong>Normal</strong> renders content as authored;{" "}
          <strong>matte</strong> renders content as a white silhouette on
          black for hardware fill+key. <strong>Mirrors</strong> reflects another
          channel's runtime state — one take fires both. <strong>Background</strong>{" "}
          sets the page colour for chroma key or solid hosts.
        </p>

        <section style={card}>
          <h3 style={sectionH}>Create channel</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 8 }}>
            <input
              value={creating.id}
              onChange={(e) => setCreating((c) => ({ ...c, id: e.target.value }))}
              placeholder="id (e.g., key-program)"
              style={{ ...input, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
            />
            <input
              value={creating.name}
              onChange={(e) => setCreating((c) => ({ ...c, name: e.target.value }))}
              placeholder="display name"
              style={input}
            />
            <select
              value={creating.renderMode}
              onChange={(e) =>
                setCreating((c) => ({ ...c, renderMode: e.target.value as ChannelRenderMode }))
              }
              style={input}
            >
              <option value="normal">normal</option>
              <option value="matte">matte (white on black)</option>
            </select>
            <select
              value={creating.mirrorOf}
              onChange={(e) => setCreating((c) => ({ ...c, mirrorOf: e.target.value }))}
              style={input}
              title="Mirror another channel's state (e.g., program, preview)"
            >
              <option value="">— no mirror —</option>
              {channels.map((o) => (
                <option key={o.id} value={o.id}>
                  mirrors {o.name}
                </option>
              ))}
            </select>
            <button
              onClick={create}
              disabled={!creating.id.trim() || conn !== "open"}
              style={primaryBtn}
            >
              Create
            </button>
          </div>
        </section>

        <h3 style={sectionH}>All channels ({channels.length})</h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {channels.length === 0 && (
            <li style={{ color: "var(--text-dim)", fontSize: 13 }}>(none)</li>
          )}
          {channels.map((c) => (
            <ChannelRow
              key={c.id}
              config={c}
              allChannels={channels}
              onSave={save}
              onRemove={() => remove(c.id, c.name)}
            />
          ))}
        </ul>
      </div>
      </main>
      {dialog}
    </>
  );
}

function ChannelRow({
  config,
  allChannels,
  onSave,
  onRemove,
}: {
  config: ChannelConfig;
  allChannels: ChannelConfig[];
  onSave: (c: ChannelConfig) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<ChannelConfig>(config);
  // Track the last config we synced from. We only want to adopt incoming
  // server config when the user has no pending edits — otherwise the
  // channel_list broadcast (fired by *any* save/delete in the system)
  // would clobber the user's mid-edit selections in this row.
  const lastSyncedRef = useRef<ChannelConfig>(config);
  useEffect(() => {
    if (JSON.stringify(draft) === JSON.stringify(lastSyncedRef.current)) {
      setDraft(config);
    }
    lastSyncedRef.current = config;
    // We deliberately depend only on `config` — `draft` is read via closure
    // at the moment the effect fires (post-render), which gives us the
    // latest user state without re-running the effect on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const mirrorOptions = allChannels.filter((o) => o.id !== config.id);

  function patch(p: Partial<ChannelConfig>) {
    setDraft((cur) => ({ ...cur, ...p }));
  }
  function revert() {
    setDraft(config);
  }

  return (
    <li style={{ marginBottom: 8, ...card }}>
      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 160px 200px auto auto", gap: 8, alignItems: "center" }}>
        <code style={{ fontSize: 12, color: "var(--text-dim)" }}>{config.id}</code>
        <input
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          style={input}
          title="Display name"
        />
        <select
          value={draft.renderMode}
          onChange={(e) => patch({ renderMode: e.target.value as ChannelRenderMode })}
          style={input}
          title="Render mode"
        >
          <option value="normal">normal</option>
          <option value="matte">matte (white on black)</option>
        </select>
        <select
          value={draft.mirrorOf ?? ""}
          onChange={(e) => patch({ mirrorOf: e.target.value || undefined })}
          style={input}
          title="Mirror of (channel whose state this one reflects)"
        >
          <option value="">— no mirror —</option>
          {mirrorOptions.map((o) => (
            <option key={o.id} value={o.id}>
              mirrors {o.name}
            </option>
          ))}
        </select>
        <div style={{ display: "flex", gap: 4 }}>
          {dirty && (
            <button onClick={revert} style={ghostBtnActive} title="Discard unsaved changes">
              Revert
            </button>
          )}
          <button
            onClick={() => onSave(draft)}
            disabled={!dirty}
            style={dirty ? primaryBtn : ghostBtn}
          >
            Save
          </button>
        </div>
        <button onClick={onRemove} style={delBtn}>×</button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "180px 1fr",
          gap: 8,
          alignItems: "center",
          marginTop: 8,
        }}
      >
        <span style={{ fontSize: 11, color: "var(--text-dim)", textAlign: "right" }}>
          background:
        </span>
        <BackgroundEditor value={draft.background} onChange={(v) => patch({ background: v })} />
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-dim)", display: "flex", gap: 12, alignItems: "center" }}>
        <a
          href={`http://localhost:3001/?channel=${encodeURIComponent(config.id)}&debug=1`}
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--accent-2)", fontFamily: "ui-monospace, monospace" }}
        >
          renderer URL
        </a>
        {draft.renderMode === "matte" && (
          <span style={{ color: "var(--text-dim)" }}>
            (matte mode forces black bg)
          </span>
        )}
        {dirty && <span style={{ color: "var(--accent-2)", marginLeft: "auto" }}>● unsaved</span>}
      </div>
    </li>
  );
}

function BackgroundEditor({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  // Be defensive: older fixtures and any external write path could omit
  // `background`, so coerce to the default rather than crash on .startsWith.
  const v = value ?? "transparent";
  const isPreset = BG_PRESETS.some((p) => p.value === v);
  const hex = v.startsWith("#") && v.length === 7 ? v : "#ffffff";

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {/* Visual swatch — checkerboard for transparent, solid otherwise. */}
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: 3,
          border: "1px solid var(--border)",
          background:
            v === "transparent"
              ? "linear-gradient(45deg, #1a1c20 25%, transparent 25%, transparent 75%, #1a1c20 75%) 0 0 / 8px 8px, #0c0d10"
              : v,
        }}
        title={v}
      />
      <select
        value={isPreset ? v : "__custom__"}
        onChange={(e) => {
          const sel = e.target.value;
          if (sel === "__custom__") {
            // Switching from a preset to custom — seed with a sensible
            // starting color so the color-picker has something valid.
            onChange(isPreset ? "#ffffff" : v);
          } else {
            onChange(sel);
          }
        }}
        style={{ ...input, width: 160 }}
      >
        {BG_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
        <option value="__custom__">custom…</option>
      </select>
      {!isPreset && (
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 32, height: 26, padding: 0, border: "1px solid var(--border)", borderRadius: 3 }}
        />
      )}
      {!isPreset && (
        <input
          value={v}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...input, fontFamily: "ui-monospace, monospace", fontSize: 11, flex: 1 }}
        />
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: 12,
  marginBottom: 12,
};
const sectionH: React.CSSProperties = {
  margin: 0,
  marginBottom: 8,
  fontSize: 11,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  color: "var(--text-dim)",
};
const input: React.CSSProperties = {
  padding: "6px 8px",
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text)",
  outline: "none",
  fontSize: 13,
  width: "100%",
};
const primaryBtn: React.CSSProperties = {
  padding: "6px 14px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "6px 14px",
  background: "transparent",
  color: "var(--text-dim)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  fontSize: 12,
  cursor: "not-allowed",
};
const ghostBtnActive: React.CSSProperties = {
  ...ghostBtn,
  color: "var(--text)",
  cursor: "pointer",
};
const delBtn: React.CSSProperties = {
  width: 36,
  height: 30,
  background: "transparent",
  color: "var(--red)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 16,
};
