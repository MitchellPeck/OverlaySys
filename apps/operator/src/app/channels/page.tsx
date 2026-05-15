"use client";

import { useEffect, useRef, useState } from "react";
import type { ChannelConfig, ChannelRenderMode } from "@overlaysys/core";
import { Button, IconButton, Input, Panel, Select, colors, radius } from "@overlaysys/ui";
import { useWs } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useDialog } from "@/lib/dialog";
import { isCloudMode } from "@/lib/mode";
import { getDesktopApi, isElectron } from "@/lib/desktop";
import {
  deleteChannelConfigCloud,
  refreshChannelConfigsCloud,
  saveChannelConfigCloud,
} from "@/lib/cloudData";
import { AppHeader } from "@/app/components/AppHeader";
import { PageShell, PageBody } from "@/app/components/PageShell";

/**
 * Resolve the renderer base URL for "open channel" links + the help text.
 * Electron exposes the real renderer URL via the `getMode` IPC (packaged
 * builds can run on ports other than the 3001 dev default). In the web
 * operator and cloud builds there's no paired renderer; we still render a
 * useful default so dev workflows match the docs.
 */
const FALLBACK_RENDERER_BASE = "http://localhost:3001";

function useRendererBase(): string {
  const [base, setBase] = useState<string>(FALLBACK_RENDERER_BASE);
  useEffect(() => {
    if (!isElectron()) return;
    const api = getDesktopApi();
    if (!api) return;
    let cancelled = false;
    api
      .getMode()
      .then((m) => {
        if (cancelled) return;
        if (m?.rendererUrl) setBase(trimTrailingSlash(m.rendererUrl));
      })
      .catch(() => {
        /* leave fallback in place */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return base;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function rendererPathLabel(base: string): string {
  try {
    const u = new URL(base);
    return u.port ? `:${u.port}/?channel=<id>` : `${u.host}/?channel=<id>`;
  } catch {
    return `${base}/?channel=<id>`;
  }
}

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
  const cloud = isCloudMode();
  const rendererBase = useRendererBase();
  const [creating, setCreating] = useState<{
    id: string;
    name: string;
    mirrorOf: string;
    renderMode: ChannelRenderMode;
  }>({ id: "", name: "", mirrorOf: "", renderMode: "normal" });
  const { confirm, alert, dialog } = useDialog();

  async function showError(action: string, err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.warn(`[channels] ${action} failed`, err);
    await alert({
      title: `Channel ${action} failed`,
      message: (
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, margin: 0 }}>
          {message}
        </pre>
      ),
    });
  }

  useEffect(() => {
    if (cloud) {
      refreshChannelConfigsCloud().catch((err) =>
        console.warn("[channels] cloud list failed", err),
      );
    } else if (conn === "open") {
      send({ type: "list_channels" });
    }
  }, [cloud, conn, send]);

  async function create() {
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
    if (cloud) {
      try {
        await saveChannelConfigCloud(config);
        await refreshChannelConfigsCloud();
      } catch (err) {
        await showError("create", err);
        return;
      }
    } else {
      send({ type: "save_channel", config });
    }
    setCreating({ id: "", name: "", mirrorOf: "", renderMode: "normal" });
  }

  async function save(config: ChannelConfig) {
    if (cloud) {
      try {
        await saveChannelConfigCloud(config);
        await refreshChannelConfigsCloud();
      } catch (err) {
        await showError("save", err);
      }
      return;
    }
    send({ type: "save_channel", config });
  }

  async function remove(id: string, name: string) {
    const ok = await confirm({
      title: "Delete channel",
      message: (
        <>
          Delete <strong>{name}</strong>?
          {cloud
            ? " This soft-deletes the channel; paired devices will remove their local copy on next sync."
            : " This removes the JSON file."}
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    if (cloud) {
      try {
        await deleteChannelConfigCloud(id);
        await refreshChannelConfigsCloud();
      } catch (err) {
        await showError("delete", err);
      }
      return;
    }
    send({ type: "delete_channel", channelId: id });
  }

  return (
    <PageShell>
      <AppHeader title="Channels" />
      <PageBody maxWidth={980}>
          {cloud && (
            <div
              style={{
                background: "var(--panel-2)",
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: 12,
                marginBottom: 16,
                color: colors.textDim,
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              Channels live here — this is the org's source of truth. Devices
              pull this configuration on sync. Per-project overrides can adjust
              individual channels for specific projects without forking the org
              defaults. <strong>Live runtime state and per-device window
              placement</strong> stay on each desktop.
            </div>
          )}
          <p style={{ color: colors.textDim, fontSize: 12, lineHeight: 1.5, marginBottom: 16 }}>
            Each channel is a renderer endpoint at{" "}
            <code>{rendererPathLabel(rendererBase)}</code>.{" "}
            <strong>Normal</strong> renders content as authored;{" "}
            <strong>matte</strong> renders content as a white silhouette on
            black for hardware fill+key. <strong>Mirrors</strong> reflects another
            channel's runtime state — one take fires both. <strong>Background</strong>{" "}
            sets the page colour for chroma key or solid hosts.
          </p>

          <Panel title="Create channel" padding="md" style={{ marginBottom: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 8 }}>
              <Input
                value={creating.id}
                onChange={(e) => setCreating((c) => ({ ...c, id: e.target.value }))}
                placeholder="id (e.g., key-program)"
                style={{ fontFamily: "ui-monospace, monospace" }}
              />
              <Input
                value={creating.name}
                onChange={(e) => setCreating((c) => ({ ...c, name: e.target.value }))}
                placeholder="display name"
              />
              <Select
                value={creating.renderMode}
                onChange={(e) =>
                  setCreating((c) => ({ ...c, renderMode: e.target.value as ChannelRenderMode }))
                }
              >
                <option value="normal">normal</option>
                <option value="matte">matte (white on black)</option>
              </Select>
              <Select
                value={creating.mirrorOf}
                onChange={(e) => setCreating((c) => ({ ...c, mirrorOf: e.target.value }))}
                title="Mirror another channel's state (e.g., program, preview)"
              >
                <option value="">— no mirror —</option>
                {channels.map((o) => (
                  <option key={o.id} value={o.id}>
                    mirrors {o.name}
                  </option>
                ))}
              </Select>
              <Button
                onClick={create}
                disabled={!creating.id.trim() || (!cloud && conn !== "open")}
                variant="primary"
                size="sm"
              >
                Create
              </Button>
            </div>
          </Panel>

          <h3
            style={{
              margin: 0,
              marginBottom: 8,
              fontSize: 11,
              letterSpacing: 1.2,
              textTransform: "uppercase",
              color: colors.textDim,
            }}
          >
            All channels ({channels.length})
          </h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {channels.length === 0 && (
              <li style={{ color: colors.textDim, fontSize: 13 }}>(none)</li>
            )}
            {channels.map((c) => (
              <ChannelRow
                key={c.id}
                config={c}
                allChannels={channels}
                rendererBase={rendererBase}
                onSave={save}
                onRemove={() => remove(c.id, c.name)}
              />
            ))}
          </ul>
      </PageBody>
      {dialog}
    </PageShell>
  );
}

function ChannelRow({
  config,
  allChannels,
  rendererBase,
  onSave,
  onRemove,
}: {
  config: ChannelConfig;
  allChannels: ChannelConfig[];
  rendererBase: string;
  onSave: (c: ChannelConfig) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<ChannelConfig>(config);
  const lastSyncedRef = useRef<ChannelConfig>(config);
  useEffect(() => {
    if (JSON.stringify(draft) === JSON.stringify(lastSyncedRef.current)) {
      setDraft(config);
    }
    lastSyncedRef.current = config;
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
    <li style={{ marginBottom: 8 }}>
      <Panel padding="md">
        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 160px 200px auto auto", gap: 8, alignItems: "center" }}>
          <code style={{ fontSize: 12, color: colors.textDim }}>{config.id}</code>
          <Input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            title="Display name"
          />
          <Select
            value={draft.renderMode}
            onChange={(e) => patch({ renderMode: e.target.value as ChannelRenderMode })}
            title="Render mode"
          >
            <option value="normal">normal</option>
            <option value="matte">matte (white on black)</option>
          </Select>
          <Select
            value={draft.mirrorOf ?? ""}
            onChange={(e) => patch({ mirrorOf: e.target.value || undefined })}
            title="Mirror of (channel whose state this one reflects)"
          >
            <option value="">— no mirror —</option>
            {mirrorOptions.map((o) => (
              <option key={o.id} value={o.id}>
                mirrors {o.name}
              </option>
            ))}
          </Select>
          <div style={{ display: "flex", gap: 4 }}>
            {dirty && (
              <Button onClick={revert} variant="ghost" size="sm" title="Discard unsaved changes">
                Revert
              </Button>
            )}
            <Button
              onClick={() => onSave(draft)}
              disabled={!dirty}
              variant={dirty ? "primary" : "ghost"}
              size="sm"
            >
              Save
            </Button>
          </div>
          <IconButton
            onClick={onRemove}
            title="Delete channel"
            style={{ color: colors.red }}
          >
            ×
          </IconButton>
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
          <span style={{ fontSize: 11, color: colors.textDim, textAlign: "right" }}>
            background:
          </span>
          <BackgroundEditor value={draft.background} onChange={(v) => patch({ background: v })} />
        </div>

        <div style={{ marginTop: 8, fontSize: 11, color: colors.textDim, display: "flex", gap: 12, alignItems: "center" }}>
          <a
            href={`${rendererBase}/?channel=${encodeURIComponent(config.id)}&debug=1`}
            target="_blank"
            rel="noreferrer"
            style={{ color: colors.accent2, fontFamily: "ui-monospace, monospace" }}
          >
            renderer URL
          </a>
          {draft.renderMode === "matte" && (
            <span style={{ color: colors.textDim }}>
              (matte mode forces black bg)
            </span>
          )}
          {dirty && <span style={{ color: colors.accent2, marginLeft: "auto" }}>● unsaved</span>}
        </div>
      </Panel>
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
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: radius.sm,
          border: `1px solid ${colors.border}`,
          background:
            v === "transparent"
              ? "linear-gradient(45deg, #1a1c20 25%, transparent 25%, transparent 75%, #1a1c20 75%) 0 0 / 8px 8px, #0c0d10"
              : v,
        }}
        title={v}
      />
      <Select
        value={isPreset ? v : "__custom__"}
        onChange={(e) => {
          const sel = e.target.value;
          if (sel === "__custom__") {
            onChange(isPreset ? "#ffffff" : v);
          } else {
            onChange(sel);
          }
        }}
        style={{ width: 160 }}
      >
        {BG_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
        <option value="__custom__">custom…</option>
      </Select>
      {!isPreset && (
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 32, height: 26, padding: 0, border: `1px solid ${colors.border}`, borderRadius: radius.sm }}
        />
      )}
      {!isPreset && (
        <Input
          value={v}
          onChange={(e) => onChange(e.target.value)}
          style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, flex: 1 }}
        />
      )}
    </div>
  );
}
