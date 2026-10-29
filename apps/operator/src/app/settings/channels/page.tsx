"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChannelConfig, ProjectChannelOverride } from "@overlaysys/core";
import { Button, SaveBar, colors, fontSize, toast, useConfirm } from "@overlaysys/ui";
import { getClient, useWs } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { isCloudMode } from "@/lib/mode";
import { getDesktopApi, isElectron } from "@/lib/desktop";
import { useAuthStore } from "@/lib/useAuth";
import { ackErrorText, sendAndAwaitAck } from "@/lib/awaitAck";
import { useConnection } from "@/lib/useConnection";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import {
  deleteChannelConfigCloud,
  deleteProjectChannelOverrideCloud,
  listProjectChannelOverridesCloud,
  refreshChannelConfigsCloud,
  saveChannelConfigCloud,
  saveProjectChannelOverrideCloud,
} from "@/lib/cloudData";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { ChannelCard } from "./ChannelCard";
import { NewChannelDialog } from "./NewChannelDialog";
import { channelConfigEqual, deleteImpact, draftAfterSave, sortChannels } from "./channelDraft";

/**
 * Resolve the renderer base URL for "open channel" links. Electron exposes the
 * real renderer URL via the `getMode` IPC; web and cloud builds use the dev
 * default so workflows match the docs.
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
        if (m?.rendererUrl) setBase(m.rendererUrl.endsWith("/") ? m.rendererUrl.slice(0, -1) : m.rendererUrl);
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

export default function ChannelsPage() {
  const { send } = useWs();
  const { connected, conn } = useConnection();
  const channels = useStore((s) => s.channelConfigs);
  const stageLayouts = useStore((s) => s.stageLayouts);
  const channelStates = useStore((s) => s.channelStates);
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const currentProject = projects.find((p) => p.id === currentProjectId);
  const projectOverridesMap = useStore((s) => s.projectChannelOverrides);
  const setProjectOverrides = useStore((s) => s.setProjectChannelOverrides);
  const cloud = isCloudMode();
  const cloudSession = useAuthStore((s) => s.status === "signed_in");
  // On desktop the local server is the source of truth for channel configs;
  // only the pure cloud build reads and writes them in the cloud directly.
  const useCloudBackend = cloud;
  const overridesAvailable = cloud || cloudSession;
  const rendererBase = useRendererBase();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);

  // Edited cards only. `editBase` is the stored config each draft started from;
  // `baselines` overrides the stored config right after an ack, until the
  // incoming channel list replaces it.
  const [drafts, setDrafts] = useState<Record<string, ChannelConfig>>({});
  const [editBase, setEditBase] = useState<Record<string, ChannelConfig>>({});
  const [baselines, setBaselines] = useState<Record<string, { cfg: ChannelConfig; base: ChannelConfig }>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savedOf = useCallback(
    (c: ChannelConfig): ChannelConfig => {
      const b = baselines[c.id];
      return b && b.base === c ? b.cfg : c;
    },
    [baselines],
  );
  const sorted = useMemo(() => sortChannels(channels), [channels]);
  const dirtyIds = useMemo(
    () => sorted.filter((c) => drafts[c.id] && !channelConfigEqual(drafts[c.id]!, savedOf(c))).map((c) => c.id),
    [sorted, drafts, savedOf],
  );
  const dirty = dirtyIds.length > 0;
  const changedElsewhere = sorted.some((c) => dirtyIds.includes(c.id) && editBase[c.id] && editBase[c.id] !== savedOf(c) && !channelConfigEqual(editBase[c.id]!, savedOf(c)));

  useEffect(() => {
    if (useCloudBackend) {
      refreshChannelConfigsCloud().catch((err) => console.warn("[channels] cloud list failed", err));
    } else if (conn === "open") {
      send({ type: "list_channels" });
    }
  }, [useCloudBackend, conn, send]);

  // Stage layouts feed the layout pickers (desktop only).
  useEffect(() => {
    if (!isCloudMode() && conn === "open") send({ type: "list_stage_layouts" });
  }, [conn, send]);

  useEffect(() => {
    if (!overridesAvailable) return;
    listProjectChannelOverridesCloud(currentProjectId)
      .then((overrides) => setProjectOverrides(overrides))
      .catch((err) => console.warn("[channels] project overrides fetch failed", err));
  }, [overridesAvailable, currentProjectId, setProjectOverrides]);

  function edit(c: ChannelConfig, next: ChannelConfig) {
    setEditBase((b) => (b[c.id] ? b : { ...b, [c.id]: c }));
    setDrafts((d) => ({ ...d, [c.id]: next }));
  }

  async function writeConfig(config: ChannelConfig): Promise<void> {
    if (useCloudBackend) {
      await saveChannelConfigCloud(config);
      await refreshChannelConfigsCloud();
      return;
    }
    await sendAndAwaitAck(getClient(), { type: "save_channel", config }, { op: "save_channel", id: config.id });
  }

  const saveAll = useCallback(async (): Promise<boolean> => {
    if (saving) return false;
    if (!connected) {
      toast({ tone: "error", message: "Not saved: Reconnect to save" });
      return false;
    }
    setSaving(true);
    setError(null);
    let failed = 0;
    let firstError = "";
    for (const c of sorted) {
      const draft = draftsRef.current[c.id];
      if (!draft || channelConfigEqual(draft, savedOf(c))) continue;
      try {
        await writeConfig(draft);
        // This card's baseline becomes the config we just saved.
        setBaselines((b) => ({ ...b, [c.id]: { cfg: draft, base: c } }));
        // Keep anything typed while the save was in flight.
        const keep = draftAfterSave(draftsRef.current[c.id], draft);
        setDrafts((d) => {
          const { [c.id]: _gone, ...rest } = d;
          return keep ? { ...rest, [c.id]: keep } : rest;
        });
        if (!keep) {
          setEditBase((d) => {
            const { [c.id]: _gone, ...rest } = d;
            return rest;
          });
        }
      } catch (e) {
        failed++;
        if (!firstError) firstError = `${c.name}: ${ackErrorText(e)}`;
      }
    }
    setSaving(false);
    if (failed > 0) {
      setError(firstError);
      toast({ tone: "error", message: `Not saved: ${firstError}` });
      return false;
    }
    toast({ tone: "ok", message: "Saved" });
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, connected, sorted, savedOf, useCloudBackend]);

  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const saveRef = useRef(saveAll);
  saveRef.current = saveAll;
  useUnsavedGuard(dirty, { onSave: () => saveRef.current() });

  async function createChannel(config: ChannelConfig): Promise<void> {
    try {
      await writeConfig(config);
    } catch (e) {
      toast({ tone: "error", message: `Not created: ${ackErrorText(e)}` });
      throw e;
    }
    toast({ tone: "ok", message: `Created ${config.name}` });
  }

  async function remove(c: ChannelConfig) {
    const impact = deleteImpact(c.id, sorted, !!channelStates[c.id]?.active);
    if (impact.blocked) {
      toast({ tone: "error", message: impact.blocked });
      return;
    }
    const warnings: string[] = [];
    if (impact.onAir) warnings.push(`${c.name} is on air right now. Deleting it takes its graphic off.`);
    if (impact.dependents.length > 0) {
      warnings.push(`These channels follow or mirror it and will stop updating: ${impact.dependents.join(", ")}.`);
    }
    const ok = await confirm({
      title: `Delete ${c.name}?`,
      message: [...warnings, "This soft-deletes the channel; other replicas remove their copy on the next sync."].join(" "),
      confirmLabel: warnings.length > 0 ? "Delete anyway" : "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      if (useCloudBackend) {
        await deleteChannelConfigCloud(c.id);
        await refreshChannelConfigsCloud();
      } else {
        await sendAndAwaitAck(getClient(), { type: "delete_channel", channelId: c.id }, { op: "delete_channel", id: c.id });
      }
      setDrafts((d) => {
        const { [c.id]: _gone, ...rest } = d;
        return rest;
      });
    } catch (e) {
      toast({ tone: "error", message: `Not deleted: ${ackErrorText(e)}` });
    }
  }

  async function saveOverride(override: ProjectChannelOverride): Promise<void> {
    if (!overridesAvailable) return;
    try {
      await saveProjectChannelOverrideCloud(override);
      setProjectOverrides(await listProjectChannelOverridesCloud(currentProjectId));
    } catch (err) {
      toast({ tone: "error", message: `Override not saved: ${ackErrorText(err)}` });
    }
  }

  async function clearOverride(channelId: string): Promise<void> {
    if (!overridesAvailable) return;
    try {
      await deleteProjectChannelOverrideCloud(currentProjectId, channelId);
      setProjectOverrides(await listProjectChannelOverridesCloud(currentProjectId));
    } catch (err) {
      toast({ tone: "error", message: `Override not cleared: ${ackErrorText(err)}` });
    }
  }

  return (
    <>
      <PageChrome
        title="Channels"
        actions={
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
            {changedElsewhere && <span style={{ fontSize: fontSize.xs, color: colors.warn }}>Changed elsewhere</span>}
            <Button size="sm" onClick={() => setCreating(true)} disabled={!connected} title={connected ? undefined : "Reconnect to create"}>
              New channel
            </Button>
            <SaveBar
              dirty={dirty}
              saving={saving}
              onSave={() => void saveAll()}
              onRevert={() => {
                setDrafts({});
                setEditBase({});
                setError(null);
              }}
              disabledReason={connected ? undefined : "Reconnect to save"}
            />
          </div>
        }
      />
      <PageBody variant="wide" style={{ minWidth: 0 }}>
        {cloud && (
          <div style={{ background: "var(--panel-2)", border: `1px solid ${colors.border}`, borderRadius: 6, padding: 12, color: colors.textDim, fontSize: 12, lineHeight: 1.5 }}>
            Channels live here and are the org&apos;s source of truth. Devices pull this configuration on sync. Per-project overrides adjust
            individual channels for one project without changing the org defaults. Live runtime state and per-device window placement stay
            on each desktop.
          </div>
        )}
        <p style={{ color: colors.textDim, fontSize: 12, lineHeight: 1.5, margin: 0 }}>
          Each channel is a renderer endpoint. Graphics outputs can mirror another channel (one take fires both) and render normally or as a
          matte for hardware fill and key. Stage monitors show another channel&apos;s current and next content.
          {!cloud && " Devices must be on the same network to open a channel remotely. On macOS, allow incoming connections for OverlaySys if asked."}
        </p>
        {error && (
          <div role="alert" style={{ color: colors.dangerText, fontSize: 12 }}>
            Not saved: {error}
          </div>
        )}
        <ul style={{ padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.length === 0 && <li style={{ color: colors.textDim, fontSize: 13, listStyle: "none" }}>No channels yet.</li>}
          {sorted.map((c) => (
            <ChannelCard
              key={c.id}
              config={drafts[c.id] ?? savedOf(c)}
              dirty={dirtyIds.includes(c.id)}
              allChannels={sorted}
              stageLayouts={stageLayouts}
              rendererBase={rendererBase}
              onChange={(next) => edit(c, next)}
              onDelete={() => void remove(c)}
              deleteDisabled={deleteImpact(c.id, sorted, false).blocked ?? undefined}
              showOverride={overridesAvailable}
              currentProjectId={currentProjectId}
              currentProjectName={currentProject?.name ?? currentProjectId}
              override={projectOverridesMap[`${currentProjectId}:${c.id}`]}
              onSaveOverride={saveOverride}
              onClearOverride={() => clearOverride(c.id)}
            />
          ))}
        </ul>
      </PageBody>
      <NewChannelDialog
        open={creating}
        channels={sorted}
        stageLayouts={stageLayouts}
        disabledReason={connected ? undefined : "Reconnect to create"}
        onClose={() => setCreating(false)}
        onCreate={createChannel}
      />
    </>
  );
}
