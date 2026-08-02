"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildImportedSong,
  resolveImportedSongId,
  type Field as TemplateField,
  type ItemPreview,
  type PcoPlan,
  type PcoPlanItem,
  type PcoServiceType,
  type Song,
  type Template,
} from "@overlaysys/core";
import {
  Button,
  Field,
  Inline,
  Modal,
  Panel,
  Pill,
  Select,
  Stack,
  colors,
} from "@overlaysys/ui";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { SongDraftEditor } from "@/app/songs/edit/SongDraftEditor";
import { getDesktopApi } from "@/lib/desktop";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { isCloudMode } from "@/lib/mode";
import { getTemplateCloud, refreshShowMetasCloud } from "@/lib/cloudData";
import { FieldInput } from "@/lib/FieldInput";
import { refillItemFields } from "@/lib/pcoFieldRefill";
import {
  getPcoStatus,
  getPlanItems,
  importPlan,
  listPlans,
  listServiceTypes,
  setPcoCredentials,
  type ImportItemConfig,
  type ImportPlanResult,
} from "@/lib/pcoClient";

type Status = "checking" | "disconnected" | "connected";
type SongAction = "link" | "create";
type RowKind = "song" | "item";

interface ItemCfg {
  include: boolean;
  kind: RowKind;
  songAction: SongAction;
  songId?: string;
  lyricTemplateId: string;
  graphicTemplateId: string;
  data: Record<string, string>;
  /** Field keys the operator typed into — preserved across template changes. */
  edited: Set<string>;
}

function planLabel(p: PcoPlan): string {
  return p.dates || p.title || p.sortDate || p.id;
}

export default function PcoPage() {
  const templates = useStore((s) => s.templates);
  const templateCache = useStore((s) => s.templateCache);
  const setTemplate = useStore((s) => s.setTemplate);
  const allShowMetas = useStore((s) => s.showMetas);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const showMetas = allShowMetas.filter((s) => s.projectId === currentProjectId);
  const { send } = useWs();
  const cloud = isCloudMode();
  const router = useRouter();

  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);

  const [serviceTypes, setServiceTypes] = useState<PcoServiceType[]>([]);
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [plans, setPlans] = useState<PcoPlan[]>([]);
  const [planId, setPlanId] = useState("");

  const [items, setItems] = useState<PcoPlanItem[]>([]);
  const [previews, setPreviews] = useState<Record<string, ItemPreview>>({});
  const [cfgs, setCfgs] = useState<Record<string, ItemCfg>>({});
  const [loadingItems, setLoadingItems] = useState(false);
  const seededRef = useRef<Set<string>>(new Set());

  // Drafts for songs this import would create, keyed by plan item id. They are
  // built here (not on the server) so the operator can configure templates,
  // fields, lyrics and arrangement *before* the song lands in the library; the
  // import request carries the configured draft along.
  const songMetas = useStore((s) => s.songs);
  const [songDrafts, setSongDrafts] = useState<Record<string, Song>>({});
  const [customizedSongs, setCustomizedSongs] = useState<Set<string>>(() => new Set());
  const [editingSongItemId, setEditingSongItemId] = useState<string | null>(null);

  const [targetMode, setTargetMode] = useState<"new" | "existing">("new");
  const [newName, setNewName] = useState("");
  const [existingShowId, setExistingShowId] = useState("");

  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportPlanResult | null>(null);

  const [patAppId, setPatAppId] = useState("");
  const [patSecret, setPatSecret] = useState("");
  const [connectingPat, setConnectingPat] = useState(false);

  // Load full template bodies (with fields) into the cache for the pickers +
  // field forms. Mirrors the show editor's hydration.
  useEffect(() => {
    for (const meta of templates) {
      if (templateCache[meta.id]) continue;
      if (cloud) {
        void getTemplateCloud(meta.id)
          .then((t) => t && setTemplate(t))
          .catch(() => undefined);
      } else {
        send({ type: "get_template", templateId: meta.id });
      }
    }
  }, [templates, templateCache, cloud, send, setTemplate]);

  // Default each config's template ids once templates arrive.
  useEffect(() => {
    const def = templates[0]?.id;
    if (!def) return;
    setCfgs((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        const c = next[id]!;
        if (!c.lyricTemplateId || !c.graphicTemplateId) {
          next[id] = {
            ...c,
            lyricTemplateId: c.lyricTemplateId || def,
            graphicTemplateId: c.graphicTemplateId || def,
          };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [templates]);

  // Fill a graphic row's fields from its PCO item once the chosen template's
  // body arrives. Keyed by item+template so switching templates re-seeds
  // (the switch handler below covers the warm-cache case; this covers the
  // cold one). `refillItemFields` preserves anything the user typed.
  useEffect(() => {
    setCfgs((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const item of items) {
        const c = next[item.id];
        if (!c || c.kind !== "item") continue;
        const seedKey = `${item.id}:${c.graphicTemplateId}`;
        if (seededRef.current.has(seedKey)) continue;
        const tpl = templateCache[c.graphicTemplateId];
        if (!tpl) continue; // wait for the body, retry when it arrives
        seededRef.current.add(seedKey);
        const data = refillItemFields({
          item,
          templateFields: tpl.fields,
          data: c.data,
          edited: c.edited,
        });
        next[item.id] = { ...c, data };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [items, templateCache]);

  const loadServiceTypes = useCallback(async () => {
    try {
      setServiceTypes(await listServiceTypes());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const s = await getPcoStatus();
      setStatus(s.connected ? "connected" : "disconnected");
      if (s.connected) void loadServiceTypes();
    } catch {
      setStatus("disconnected");
    }
  }, [loadServiceTypes]);

  useEffect(() => {
    void checkStatus();
    const api = getDesktopApi();
    const offIn = api?.onPcoSignedIn?.(() => void checkStatus());
    const offOut = api?.onPcoSignedOut?.(() => setStatus("disconnected"));
    return () => {
      offIn?.();
      offOut?.();
    };
  }, [checkStatus]);

  async function signIn() {
    setError(null);
    const api = getDesktopApi();
    if (!api?.pcoSignIn) {
      setError("Open the OverlaySys desktop app to connect Planning Center.");
      return;
    }
    const res = await api.pcoSignIn();
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setTimeout(() => void checkStatus(), 600);
  }

  async function connectWithPat() {
    setError(null);
    if (!patAppId.trim() || !patSecret.trim()) {
      setError("Enter both the Application ID and Secret.");
      return;
    }
    setConnectingPat(true);
    try {
      await setPcoCredentials({ appId: patAppId.trim(), secret: patSecret.trim() });
      setPatSecret("");
      await checkStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnectingPat(false);
    }
  }

  async function onPickServiceType(id: string) {
    setServiceTypeId(id);
    setPlans([]);
    setPlanId("");
    setItems([]);
    if (!id) return;
    try {
      setPlans(await listPlans(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onPickPlan(id: string) {
    setPlanId(id);
    setItems([]);
    setResult(null);
    if (!id) return;
    setLoadingItems(true);
    setError(null);
    try {
      const { items: fetched, previews: pv } = await getPlanItems(serviceTypeId, id);
      const map: Record<string, ItemPreview> = {};
      for (const p of pv) map[p.itemId] = p;
      const def = templates[0]?.id ?? "";
      const nextCfgs: Record<string, ItemCfg> = {};
      for (const it of fetched) {
        const preview = map[it.id];
        const isSong = it.itemType === "song" && !!it.song;
        nextCfgs[it.id] = {
          include: true,
          kind: isSong ? "song" : "item",
          songAction: preview?.match ? "link" : "create",
          songId: preview?.match?.songId,
          lyricTemplateId: def,
          graphicTemplateId: def,
          data: {},
          edited: new Set<string>(),
        };
      }
      seededRef.current = new Set();
      // A new plan means new items — drop every draft built for the old one.
      setSongDrafts({});
      setCustomizedSongs(new Set());
      setEditingSongItemId(null);
      setItems(fetched);
      setPreviews(map);
      setCfgs(nextCfgs);
      const plan = plans.find((p) => p.id === id);
      if (plan) setNewName(planLabel(plan));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingItems(false);
    }
  }

  const patch = useCallback((itemId: string, updater: (c: ItemCfg) => ItemCfg) => {
    setCfgs((prev) => {
      const c = prev[itemId];
      if (!c) return prev;
      return { ...prev, [itemId]: updater(c) };
    });
  }, []);

  function setKind(item: PcoPlanItem, kind: RowKind) {
    patch(item.id, (c) => {
      if (kind !== "item") return { ...c, kind };
      const tpl = templateCache[c.graphicTemplateId];
      if (!tpl) return { ...c, kind };
      seededRef.current.add(`${item.id}:${c.graphicTemplateId}`);
      return {
        ...c,
        kind,
        data: refillItemFields({
          item,
          templateFields: tpl.fields,
          data: c.data,
          edited: c.edited,
        }),
      };
    });
  }

  const includedCount = useMemo(
    () => items.filter((i) => cfgs[i.id]?.include).length,
    [items, cfgs],
  );

  // Items that will put a NEW song into the library. Linked songs are excluded
  // on purpose — their configuration already lives in the library and the
  // import must not silently overwrite it.
  const creatingSongItems = useMemo(
    () =>
      items.filter((it) => {
        const c = cfgs[it.id];
        return (
          !!c?.include &&
          c.kind === "song" &&
          c.songAction === "create" &&
          it.itemType === "song" &&
          !!it.song
        );
      }),
    [items, cfgs],
  );

  // Build each draft with the same core builders the server would use, so the
  // modal shows exactly what would otherwise be created. Drafts are built
  // lazily and never rebuilt — whatever the operator edited must survive an
  // unrelated re-render. Ids are resolved against the library plus the drafts
  // already built this session; the server re-resolves anyway, this is just
  // for display.
  useEffect(() => {
    setSongDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      const taken = new Set(songMetas.map((s) => s.id));
      for (const draft of Object.values(next)) taken.add(draft.id);
      for (const item of creatingSongItems) {
        if (next[item.id] || !item.song) continue;
        const songId = resolveImportedSongId(item.song, taken);
        taken.add(songId);
        next[item.id] = buildImportedSong(songId, item.song, item.arrangement).song;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [creatingSongItems, songMetas]);

  const canImport = useMemo(() => {
    if (includedCount === 0 || importing) return false;
    if (targetMode === "existing" && !existingShowId) return false;
    return true;
  }, [includedCount, importing, targetMode, existingShowId]);

  /**
   * Make the imported show the active one and jump to its editor. The server
   * already broadcasts show_list/song_list after an import, so local mode only
   * needs the get_show; cloud mode has no broadcast and refreshes explicitly.
   */
  const openShow = useCallback(
    async (showId: string) => {
      if (cloud) await refreshShowMetasCloud();
      else send({ type: "get_show", showId });
      router.push(`/shows/edit?id=${encodeURIComponent(showId)}`);
    },
    [cloud, send, router],
  );

  async function doImport() {
    setImporting(true);
    setResult(null);
    setError(null);
    try {
      const payload: ImportItemConfig[] = [];
      for (const it of items) {
        const c = cfgs[it.id];
        if (!c?.include) continue;
        const isSong = it.itemType === "song" && !!it.song;
        if (isSong && c.kind === "song") {
          // The server only honours a supplied draft on the "create" branch —
          // keep the draft and songAction paired or it is silently discarded.
          const draft = c.songAction === "create" ? songDrafts[it.id] : undefined;
          payload.push({
            itemId: it.id,
            kind: "song",
            songAction: c.songAction,
            songId: c.songAction === "link" ? c.songId : undefined,
            templateId: c.lyricTemplateId || undefined,
            ...(draft ? { song: draft } : {}),
          });
        } else {
          payload.push({
            itemId: it.id,
            kind: "graphic",
            templateId: c.graphicTemplateId || undefined,
            data: c.data,
          });
        }
      }
      const res = await importPlan({
        serviceTypeId,
        planId,
        planTitle: newName,
        target:
          targetMode === "new"
            ? { mode: "new", name: newName, projectId: currentProjectId }
            : { mode: "existing", showId: existingShowId },
        items: payload,
      });
      setResult(res);
      if (res.ok && res.showId) await openShow(res.showId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <PageChrome title="Planning Center" />
      <PageBody maxWidth={1000} style={{ height: "100%" }}>
        {status === "checking" && <p style={{ color: colors.textDim }}>Checking connection…</p>}

        {status === "disconnected" && (
          <Panel title="Connect to Planning Center">
            <Stack gap={3}>
              <p style={{ color: colors.textDim }}>
                Import service plans from Planning Center into OverlaySys.
              </p>

              <div>
                <div style={{ color: colors.textDim, fontSize: 13, marginBottom: 6 }}>
                  Personal Access Token (recommended for now)
                </div>
                <Stack gap={2}>
                  <Field
                    label="Application ID"
                    hint="The first value of your Personal Access Token (PCO may label it “Client ID”)."
                  >
                    <input
                      value={patAppId}
                      onChange={(e) => setPatAppId(e.target.value)}
                      autoComplete="off"
                      style={inputStyle}
                    />
                  </Field>
                  <Field label="Secret">
                    <input
                      type="password"
                      value={patSecret}
                      onChange={(e) => setPatSecret(e.target.value)}
                      autoComplete="off"
                      style={inputStyle}
                    />
                  </Field>
                  <div>
                    <Button variant="primary" disabled={connectingPat} onClick={() => void connectWithPat()}>
                      {connectingPat ? "Connecting…" : "Connect"}
                    </Button>
                  </div>
                  <p style={{ color: colors.textDim, fontSize: 12 }}>
                    Create one at api.planningcenteronline.com → Developer → Personal
                    Access Tokens. Both values are required (used as HTTP Basic auth).
                  </p>
                </Stack>
              </div>

              <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
                <div style={{ color: colors.textDim, fontSize: 13, marginBottom: 6 }}>
                  Or sign in with OAuth (desktop app)
                </div>
                <Button variant="secondary" onClick={() => void signIn()}>
                  Sign in with Planning Center
                </Button>
              </div>

              {error && <p style={{ color: colors.errorText }}>{error}</p>}
            </Stack>
          </Panel>
        )}

        {status === "connected" && (
          <Stack gap={4}>
            <Panel title="Select a plan">
              <Stack gap={3}>
                <Field label="Service type">
                  <Select value={serviceTypeId} onChange={(e) => void onPickServiceType(e.target.value)}>
                    <option value="">— choose —</option>
                    {serviceTypes.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Plan">
                  <Select
                    value={planId}
                    onChange={(e) => void onPickPlan(e.target.value)}
                    disabled={plans.length === 0}
                  >
                    <option value="">— choose —</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {planLabel(p)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </Stack>
            </Panel>

            {loadingItems && <p style={{ color: colors.textDim }}>Loading plan items…</p>}

            {items.length > 0 && (
              <Panel title={`Items (${includedCount}/${items.length} selected)`}>
                <Stack gap={2}>
                  {items.map((item) => {
                    const cfg = cfgs[item.id];
                    if (!cfg) return null;
                    return (
                      <ItemConfigCard
                        key={item.id}
                        item={item}
                        preview={previews[item.id]}
                        cfg={cfg}
                        templates={templates}
                        template={templateCache[cfg.graphicTemplateId] ?? null}
                        onToggleInclude={() =>
                          patch(item.id, (c) => ({ ...c, include: !c.include }))
                        }
                        onKind={(k) => setKind(item, k)}
                        onSongAction={(a) => patch(item.id, (c) => ({ ...c, songAction: a }))}
                        onLyricTemplate={(id) => patch(item.id, (c) => ({ ...c, lyricTemplateId: id }))}
                        onGraphicTemplate={(id) =>
                          patch(item.id, (c) => {
                            const tpl = templateCache[id];
                            if (!tpl) return { ...c, graphicTemplateId: id };
                            seededRef.current.add(`${item.id}:${id}`);
                            return {
                              ...c,
                              graphicTemplateId: id,
                              data: refillItemFields({
                                item,
                                templateFields: tpl.fields,
                                data: c.data,
                                edited: c.edited,
                              }),
                            };
                          })
                        }
                        onFieldChange={(key, value) =>
                          patch(item.id, (c) => ({
                            ...c,
                            data: { ...c.data, [key]: value },
                            edited: new Set(c.edited).add(key),
                          }))
                        }
                      />
                    );
                  })}
                </Stack>
              </Panel>
            )}

            {creatingSongItems.length > 0 && (
              <Panel title={`New songs (${creatingSongItems.length})`}>
                <Stack gap={2}>
                  <p style={{ color: colors.textDim, fontSize: 12 }}>
                    These songs will be written to the library on import. Edit one to
                    set its templates, fields, lyrics and arrangement first.
                  </p>
                  {creatingSongItems.map((item) => {
                    const draft = songDrafts[item.id];
                    const pv = previews[item.id];
                    // A prior-import (pco-id) match means the server updates that
                    // library song in place — the draft replaces its config.
                    const updatesExisting = pv?.match?.confidence === "pco-id";
                    return (
                      <div
                        key={item.id}
                        style={{
                          border: `1px solid ${colors.border}`,
                          borderRadius: 6,
                          padding: 12,
                        }}
                      >
                        <Inline gap={2} align="center">
                          <strong style={{ color: colors.text }}>
                            {draft?.title ?? item.title}
                          </strong>
                          <Pill tone={updatesExisting ? "warn" : "accent"} uppercase>
                            {updatesExisting ? "updates existing" : "creates new"}
                          </Pill>
                          {pv?.hasLyrics === false && (
                            <Pill tone="dim" uppercase>
                              no lyrics
                            </Pill>
                          )}
                          {customizedSongs.has(item.id) && (
                            <Pill tone="good" uppercase>
                              customized
                            </Pill>
                          )}
                          <div style={{ marginLeft: "auto" }}>
                            <Button
                              size="sm"
                              disabled={!draft}
                              onClick={() => setEditingSongItemId(item.id)}
                            >
                              Edit…
                            </Button>
                          </div>
                        </Inline>
                      </div>
                    );
                  })}
                </Stack>
              </Panel>
            )}

            {editingSongItemId && songDrafts[editingSongItemId] && (
              <SongDraftModal
                // `local` inside the modal is seeded from `draft` once, so the
                // modal must remount when the operator edits a different item.
                key={editingSongItemId}
                draft={songDrafts[editingSongItemId]!}
                onCancel={() => setEditingSongItemId(null)}
                onSave={(next) => {
                  const itemId = editingSongItemId;
                  setSongDrafts((prev) => ({ ...prev, [itemId]: next }));
                  // The modal hands back the very object it was given when the
                  // operator changed nothing (every editor edit allocates a new
                  // draft), so identity is enough to drive the pill.
                  if (next !== songDrafts[itemId]) {
                    setCustomizedSongs((prev) => new Set(prev).add(itemId));
                  }
                  setEditingSongItemId(null);
                }}
              />
            )}

            {items.length > 0 && (
              <Panel title="Import target">
                <Stack gap={3}>
                  <Field label="Destination">
                    <Select
                      value={targetMode}
                      onChange={(e) => setTargetMode(e.target.value as "new" | "existing")}
                    >
                      <option value="new">Create a new show</option>
                      <option value="existing">Add to an existing show</option>
                    </Select>
                  </Field>
                  {targetMode === "new" ? (
                    <Field label="New show name">
                      <input value={newName} onChange={(e) => setNewName(e.target.value)} style={inputStyle} />
                    </Field>
                  ) : (
                    <Field label="Existing show">
                      <Select value={existingShowId} onChange={(e) => setExistingShowId(e.target.value)}>
                        <option value="">— choose —</option>
                        {showMetas.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  <div>
                    <Button variant="primary" disabled={!canImport} onClick={() => void doImport()}>
                      {importing ? "Importing…" : `Import ${includedCount} item(s)`}
                    </Button>
                  </div>
                </Stack>
              </Panel>
            )}

            {error && <p style={{ color: colors.errorText }}>{error}</p>}

            {result && (
              <Panel title={result.ok ? "Import complete" : "Import finished with errors"}>
                <Stack gap={2}>
                  <p style={{ color: colors.text }}>
                    {result.counts.rows} row(s) · {result.counts.songsCreated} song(s) created ·{" "}
                    {result.counts.songsLinked} linked · {result.counts.songsUpdated} updated
                  </p>
                  {result.warnings.map((w, i) => (
                    <p key={i} style={{ color: colors.textDim, fontSize: 13 }}>
                      ⚠ {w}
                    </p>
                  ))}
                  {result.errors.map((e, i) => (
                    <p key={i} style={{ color: colors.errorText, fontSize: 13 }}>
                      {e.itemId}: {e.message}
                    </p>
                  ))}
                  {!result.ok && result.showId && (
                    <div>
                      <Button size="sm" onClick={() => void openShow(result.showId!)}>
                        Open show
                      </Button>
                    </div>
                  )}
                </Stack>
              </Panel>
            )}
          </Stack>
        )}
      </PageBody>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "4px 8px",
  background: colors.panel2,
  border: `1px solid ${colors.border}`,
  borderRadius: 4,
  color: colors.text,
  fontSize: 13,
  boxSizing: "border-box",
};

function ItemConfigCard({
  item,
  preview,
  cfg,
  templates,
  template,
  onToggleInclude,
  onKind,
  onSongAction,
  onLyricTemplate,
  onGraphicTemplate,
  onFieldChange,
}: {
  item: PcoPlanItem;
  preview: ItemPreview | undefined;
  cfg: ItemCfg;
  templates: { id: string; name: string }[];
  template: Template | null;
  onToggleInclude: () => void;
  onKind: (k: RowKind) => void;
  onSongAction: (a: SongAction) => void;
  onLyricTemplate: (id: string) => void;
  onGraphicTemplate: (id: string) => void;
  onFieldChange: (key: string, value: string) => void;
}) {
  const isSong = item.itemType === "song" && !!item.song;
  const hasMatch = !!preview?.match;
  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: 12,
        opacity: cfg.include ? 1 : 0.55,
      }}
    >
      <Inline gap={2} align="center">
        <input type="checkbox" checked={cfg.include} onChange={onToggleInclude} />
        <strong style={{ color: colors.text }}>{item.title}</strong>
        <Pill tone={isSong ? "accent" : "dim"} uppercase>
          {item.itemType}
        </Pill>
      </Inline>

      {cfg.include && (
        <div style={{ marginTop: 10 }}>
          <Field label="Import as">
            <Select value={cfg.kind} onChange={(e) => onKind(e.target.value as RowKind)} disabled={!isSong}>
              {isSong && <option value="song">Song (lyrics)</option>}
              <option value="item">Item (graphic)</option>
            </Select>
          </Field>

          {isSong && cfg.kind === "song" ? (
            <>
              <Field label="Song">
                <Select value={cfg.songAction} onChange={(e) => onSongAction(e.target.value as SongAction)}>
                  {hasMatch && <option value="link">Link to “{preview!.match!.title}”</option>}
                  <option value="create">Create new song</option>
                </Select>
              </Field>
              {cfg.songAction === "create" && preview?.hasLyrics === false && (
                <p style={{ color: colors.textDim, fontSize: 12, marginTop: -4 }}>
                  No lyrics in arrangement — an empty stub will be created.
                </p>
              )}
              <Field label="Lyric template">
                <Select value={cfg.lyricTemplateId} onChange={(e) => onLyricTemplate(e.target.value)}>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : (
            <>
              <Field label="Template">
                <Select value={cfg.graphicTemplateId} onChange={(e) => onGraphicTemplate(e.target.value)}>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <GraphicFields template={template} data={cfg.data} onChange={onFieldChange} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Hosts {@link SongDraftEditor} in a modal with its own local draft, so
 * Cancel discards the operator's edits and Save commits them in one go.
 * `local` is deliberately non-nullable: the editor drives it with functional
 * updaters, so its setter must be a `Dispatch<SetStateAction<Song>>`.
 */
function SongDraftModal({
  draft,
  onCancel,
  onSave,
}: {
  draft: Song;
  onCancel: () => void;
  onSave: (next: Song) => void;
}) {
  const [local, setLocal] = useState<Song>(draft);
  const bodyRef = useRef<HTMLDivElement>(null);
  // True when Escape was pressed while a nested dialog was open. See the
  // effect below — this is sampled during capture, deliberately not read live.
  const escapeHitNestedRef = useRef(false);

  // `SongDraftEditor` opens `useDialog` confirms (e.g. "Delete section"), which
  // are themselves Modals nested inside our children. Every Modal registers its
  // own window keydown listener — the confirm's is capture-phase, ours is
  // bubble-phase — and `preventDefault()` on one does not stop the other. So a
  // single Escape meant for the confirm would ALSO reach us and discard the
  // whole draft. We can't test for the nested dialog when our own handler runs:
  // React flushes the confirm's close in a microtask, and browsers run a
  // microtask checkpoint *between* listeners of one dispatch, so by then the
  // nested dialog may already be unmounted. Instead we snapshot the answer from
  // a capture-phase listener registered at mount — capture listeners on the
  // same target fire in registration order, and the confirm registers its own
  // only when it opens, so ours always runs first, before anything closes.
  useEffect(() => {
    function onKeyDownCapture(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      escapeHitNestedRef.current = !!bodyRef.current?.querySelector('[role="dialog"]');
    }
    window.addEventListener("keydown", onKeyDownCapture, true);
    return () => window.removeEventListener("keydown", onKeyDownCapture, true);
  }, []);

  return (
    <Modal
      open
      size="lg"
      title={`Configure “${draft.title}”`}
      // Escape only cancels this editor when it wasn't aimed at a nested dialog.
      onCancel={() => {
        if (escapeHitNestedRef.current) return;
        onCancel();
      }}
      // An editor this large must not be dismissible by a stray click — losing
      // an arrangement's worth of edits to a mis-aimed click is not recoverable.
      closeOnBackdrop={false}
      onClose={onCancel}
      footer={
        <>
          <Button size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={() => onSave(local)}>
            Save
          </Button>
        </>
      }
    >
      {/* Wrapper exists so the Escape guard above can scope its nested-dialog
          lookup to this editor's own subtree. */}
      <div ref={bodyRef}>
        <SongDraftEditor draft={local} onChange={setLocal} />
      </div>
    </Modal>
  );
}

function GraphicFields({
  template,
  data,
  onChange,
}: {
  template: Template | null;
  data: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  if (!template) return <p style={{ color: colors.textDim, fontSize: 12 }}>Loading template…</p>;
  if (template.fields.length === 0)
    return <p style={{ color: colors.textDim, fontSize: 12 }}>Template declares no fields.</p>;
  return (
    <Stack gap={2}>
      {template.fields.map((f: TemplateField) => (
        <Field key={f.key} label={f.label || f.key}>
          <FieldInput field={f} value={data[f.key]} onChange={(v) => onChange(f.key, v)} />
        </Field>
      ))}
    </Stack>
  );
}
