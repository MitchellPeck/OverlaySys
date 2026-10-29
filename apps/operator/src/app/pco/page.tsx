"use client";

import { TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildImportedSong,
  effectiveLyricsArrangement,
  resolveImportedSongId,
  type ItemPreview,
  type PcoPlan,
  type PcoPlanItem,
  type PcoServiceType,
  type Song,
} from "@overlaysys/core";
import {
  Button,
  Checkbox,
  Field,
  Inline,
  Input,
  Modal,
  Panel,
  Pill,
  Select,
  Stack,
  colors,
  StatusDot,
  useConfirm,
} from "@overlaysys/ui";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { SongDraftEditor } from "@/app/songs/edit/SongDraftEditor";
import { getDesktopApi } from "@/lib/desktop";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { isCloudMode } from "@/lib/mode";
import { getTemplateCloud, refreshShowMetasCloud } from "@/lib/cloudData";
import { guessScriptureReference, type TranslationMeta } from "@overlaysys/scripture";
import { listTranslations } from "@/lib/scriptureClient";
import { useScriptureSettings } from "@/lib/scriptureSettings";
import { budgetForPref, loadSlideSizePref } from "@/lib/slideSizePref";
import { refillItemFields } from "@/lib/pcoFieldRefill";
import {
  getPcoStatus,
  getPlanItems,
  importPlan,
  listPlans,
  listServiceTypes,
  disconnectPco,
  PcoNotConnectedError,
  setPcoCredentials,
  type ImportItemConfig,
  type ImportPlanResult,
} from "@/lib/pcoClient";

import { PcoConnectForm } from "./PcoConnectForm";
import { PcoPlanPicker, planLabel } from "./PcoPlanPicker";
import { PcoItemList } from "./PcoItemList";
import { PcoItemRow, importAsOf, referenceError, type ItemCfg, type RowKind } from "./PcoItemRow";
import { PcoImportFooter } from "./PcoImportFooter";
import { importSummary, type ImportAs } from "./importOptions";

type Status = "checking" | "disconnected" | "connected";

const SCRIPTURE_TRANSLATION_KEY = "overlaysys.pco.scriptureTranslation";

function loadRememberedTranslation(): string {
  try {
    return localStorage.getItem(SCRIPTURE_TRANSLATION_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberTranslation(id: string): void {
  try {
    localStorage.setItem(SCRIPTURE_TRANSLATION_KEY, id);
  } catch {
    // storage unavailable — the choice just isn't remembered
  }
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

  const scriptureSettings = useScriptureSettings();
  const [translations, setTranslations] = useState<TranslationMeta[]>([]);
  // Last translation the operator picked on this page (persisted).
  const [pickedTranslation, setPickedTranslation] = useState("");
  useEffect(() => {
    setPickedTranslation(loadRememberedTranslation());
    let cancelled = false;
    listTranslations()
      .then((t) => {
        if (!cancelled) setTranslations(t);
      })
      .catch(() => {
        // no translations → scripture items stay un-importable until reload
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const defaultTranslation =
    translations.find((t) => t.id === pickedTranslation)?.id ?? translations[0]?.id ?? "";
  const defaultScriptureTemplateId = (() => {
    const def = scriptureSettings?.defaultTemplateId;
    return def && templates.some((t) => t.id === def) ? def : "";
  })();
  const effTranslation = (c: ItemCfg) => c.translation || defaultTranslation;
  const effScriptureTemplate = (c: ItemCfg) =>
    c.scriptureTemplateId || defaultScriptureTemplateId || c.graphicTemplateId;

  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);

  const [serviceTypes, setServiceTypes] = useState<PcoServiceType[]>([]);
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [plans, setPlans] = useState<PcoPlan[]>([]);
  const [planId, setPlanId] = useState("");
  const [plansLoading, setPlansLoading] = useState(false);
  const confirm = useConfirm();

  const [items, setItems] = useState<PcoPlanItem[]>([]);
  const [previews, setPreviews] = useState<Record<string, ItemPreview>>({});
  const [cfgs, setCfgs] = useState<Record<string, ItemCfg>>({});
  const [loadingItems, setLoadingItems] = useState(false);
  /** itemId → shows that already hold a row imported from it. */
  const [imported, setImported] = useState<Record<string, { showId: string; showName: string }[]>>({});
  const seededRef = useRef<Set<string>>(new Set());
  /** Latest plan request; a slower reply for an earlier pick is dropped. */
  const planRequestRef = useRef(0);
  const serviceTypeRequestRef = useRef(0);

  // Drafts for songs this import would create, keyed by plan item id. They are
  // built here (not on the server) so the operator can configure templates,
  // fields, lyrics and arrangement *before* the song lands in the library; the
  // import request carries the configured draft along.
  const songMetas = useStore((s) => s.songs);
  const [songDrafts, setSongDrafts] = useState<Record<string, Song>>({});
  const [customizedSongs, setCustomizedSongs] = useState<Set<string>>(() => new Set());
  const [editingSongItemId, setEditingSongItemId] = useState<string | null>(null);

  const [targetMode, setTargetMode] = useState<"new" | "existing">("new");
  const [reorderToPlan, setReorderToPlan] = useState(false);
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
      if (err instanceof PcoNotConnectedError) {
        // The server dropped a dead credential; go back to the connect form.
        setStatus("disconnected");
        setError("Planning Center rejected the saved credential. Reconnect to continue.");
        return;
      }
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

  async function disconnect() {
    const ok = await confirm({
      title: "Disconnect Planning Center?",
      message: "You will need to paste your Application ID and Secret again to import plans.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await disconnectPco(() => getDesktopApi()?.pcoSignOut?.());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await checkStatus();
      return;
    }
    setServiceTypes([]);
    setServiceTypeId("");
    setPlans([]);
    setPlanId("");
    setItems([]);
    setStatus("disconnected");
  }

  async function onPickServiceType(id: string) {
    // Invalidate any in-flight plan-items request for the old service type.
    planRequestRef.current += 1;
    setServiceTypeId(id);
    setPlans([]);
    setPlanId("");
    setItems([]);
    setImported({});
    setLoadingItems(false);
    setError(null);
    const stRequest = ++serviceTypeRequestRef.current;
    if (!id) {
      setPlansLoading(false);
      return;
    }
    setPlansLoading(true);
    try {
      const fetched = await listPlans(id);
      if (stRequest === serviceTypeRequestRef.current) setPlans(fetched);
    } catch (err) {
      if (stRequest === serviceTypeRequestRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (stRequest === serviceTypeRequestRef.current) setPlansLoading(false);
    }
  }

  async function onPickPlan(id: string) {
    const requestId = ++planRequestRef.current;
    setPlanId(id);
    setItems([]);
    setImported({});
    setResult(null);
    if (!id) {
      setLoadingItems(false);
      return;
    }
    setLoadingItems(true);
    setError(null);
    try {
      const { items: fetched, previews: pv, imported: importedMap } = await getPlanItems(serviceTypeId, id);
      // The operator picked another plan while this one loaded: drop it.
      if (requestId !== planRequestRef.current) return;
      const map: Record<string, ItemPreview> = {};
      for (const p of pv) map[p.itemId] = p;
      const def = templates[0]?.id ?? "";
      const nextCfgs: Record<string, ItemCfg> = {};
      for (const it of fetched) {
        // Headers become show sections on the server; they have no row config.
        if (it.itemType === "header") continue;
        const preview = map[it.id];
        const isSong = it.itemType === "song" && !!it.song;
        const guessed = isSong ? null : guessScriptureReference(it.title);
        nextCfgs[it.id] = {
          include: true,
          kind: isSong ? "song" : guessed ? "scripture" : "item",
          reference: guessed ?? "",
          translation: "",
          scriptureTemplateId: "",
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
      setImported(importedMap ?? {});
      const plan = plans.find((p) => p.id === id);
      if (plan) setNewName(planLabel(plan));
    } catch (err) {
      if (requestId === planRequestRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestId === planRequestRef.current) setLoadingItems(false);
    }
  }

  function setAllIncluded(include: boolean) {
    setCfgs((prev) => {
      const next: Record<string, ItemCfg> = {};
      for (const [k, c] of Object.entries(prev)) next[k] = c.include === include ? c : { ...c, include };
      return next;
    });
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
      if (kind === "scripture") {
        return { ...c, kind, reference: c.reference || guessScriptureReference(item.title) || "" };
      }
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

  /** Row "Import as" select: skip unchecks the row, song/graphic re-includes it. */
  function setImportAs(item: PcoPlanItem, as: ImportAs) {
    if (as === "skip") {
      patch(item.id, (c) => ({ ...c, include: false }));
      return;
    }
    patch(item.id, (c) => ({ ...c, include: true }));
    if (as === "song") setKind(item, "song");
    else setKind(item, guessScriptureReference(item.title) ? "scripture" : "item");
  }

  /** Flip a graphic row between a plain graphic and a scripture reading. */
  function toggleScripture(item: PcoPlanItem) {
    const cur = cfgs[item.id];
    if (!cur) return;
    setKind(item, cur.kind === "scripture" ? "item" : "scripture");
  }

  const selectableCount = Object.keys(cfgs).length;
  const includedCount = useMemo(
    () => items.filter((i) => cfgs[i.id]?.include).length,
    [items, cfgs],
  );

  /**
   * Items that will put a NEW song into the library — at most ONE entry per
   * PCO song id, keeping the first occurrence in plan order.
   *
   * Why the dedupe (do not "simplify" it away): this page models a draft per
   * PLAN ITEM, but the server (server/src/pco/importPlan.ts) resolves and
   * persists library songs per PCO SONG ID. A plan that lists the same song
   * twice — a reprise, say — therefore writes ONE library song from TWO
   * independently-editable drafts, and the second write silently clobbers the
   * first. Collapsing the editable entries means the operator can only produce
   * one draft per library song, so there is nothing to clobber. This collapses
   * the panel entries only: every row still imports, and `doImport` fans the
   * surviving draft back out to every row sharing that PCO song id.
   *
   * Linked songs are excluded on purpose — their configuration already lives
   * in the library and the import must not silently overwrite it.
   */
  const creatingSongItems = useMemo(() => {
    const seenPcoSongIds = new Set<string>();
    return items.filter((it) => {
      const c = cfgs[it.id];
      if (
        !c?.include ||
        c.kind !== "song" ||
        c.songAction !== "create" ||
        it.itemType !== "song" ||
        !it.song
      ) {
        return false;
      }
      if (seenPcoSongIds.has(it.song.id)) return false;
      seenPcoSongIds.add(it.song.id);
      return true;
    });
  }, [items, cfgs]);

  // The drafts above, re-keyed by PCO song id so `doImport` can attach the one
  // surviving draft to every row referencing the same PCO song (see the dedupe
  // rationale on `creatingSongItems`).
  const songDraftsByPcoSongId = useMemo(() => {
    const map: Record<string, Song> = {};
    for (const item of creatingSongItems) {
      const draft = songDrafts[item.id];
      if (item.song && draft) map[item.song.id] = draft;
    }
    return map;
  }, [creatingSongItems, songDrafts]);

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
        next[item.id] = buildImportedSong(
          songId,
          item.song,
          effectiveLyricsArrangement(item),
        ).song;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [creatingSongItems, songMetas]);

  const canImport = useMemo(() => {
    if (includedCount === 0 || importing) return false;
    if (targetMode === "existing" && !existingShowId) return false;
    for (const it of items) {
      const c = cfgs[it.id];
      if (c?.include && c.kind === "scripture") {
        if (referenceError(c.reference) || !(c.translation || defaultTranslation)) return false;
      }
    }
    return true;
  }, [includedCount, importing, targetMode, existingShowId, items, cfgs, defaultTranslation]);

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
          // Looked up by PCO song id, not item id: a plan may reference one
          // PCO song from several rows and only the first owns a draft.
          const draft =
            c.songAction === "create" && it.song
              ? songDraftsByPcoSongId[it.song.id]
              : undefined;
          payload.push({
            itemId: it.id,
            kind: "song",
            songAction: c.songAction,
            songId: c.songAction === "link" ? c.songId : undefined,
            templateId: c.lyricTemplateId || undefined,
            ...(draft ? { song: draft } : {}),
          });
        } else if (c.kind === "scripture") {
          payload.push({
            itemId: it.id,
            kind: "scripture",
            reference: c.reference.trim(),
            translation: effTranslation(c),
            templateId: effScriptureTemplate(c) || undefined,
            slideMaxChars: budgetForPref(loadSlideSizePref()).maxChars,
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
        planDate: plans.find((p) => p.id === planId)?.sortDate,
        target:
          targetMode === "new"
            ? { mode: "new", name: newName, projectId: currentProjectId }
            : { mode: "existing", showId: existingShowId },
        items: payload,
        ...(targetMode === "existing" && reorderToPlan ? { reorderToPlan: true } : {}),
      });
      setResult(res);
      // Stay on the page when rows were dropped from the plan, so the
      // operator sees which ones to review.
      if (res.ok && res.showId && !res.removedRows?.length) await openShow(res.showId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  const titleOf = (itemId: string) => items.find((i) => i.id === itemId)?.title ?? "Unknown item";
  const summary = importSummary(
    Object.values(cfgs).map((c) => ({ include: c.include, importAs: importAsOf(c) })),
  );

  return (
    <>
      <PageChrome title="Planning Center" />
      <PageBody maxWidth={1000} style={{ height: "100%" }}>
        {status === "checking" && <p style={{ color: colors.textDim }}>Checking connection…</p>}

        {status === "disconnected" && (
          <PcoConnectForm
            appId={patAppId}
            secret={patSecret}
            connecting={connectingPat}
            error={error}
            showOAuth={!cloud}
            onAppId={setPatAppId}
            onSecret={setPatSecret}
            onSubmit={() => void connectWithPat()}
            onOAuth={() => void signIn()}
          />
        )}

        {status === "connected" && (
          <Stack gap={4}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <strong style={{ color: colors.text, fontSize: 14 }}>Connected to Planning Center</strong>
              <Button variant="danger" size="sm" onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </div>
            <Panel title="Select a plan">
              <PcoPlanPicker
                serviceTypes={serviceTypes}
                serviceTypeId={serviceTypeId}
                plans={plans}
                plansLoading={plansLoading}
                planId={planId}
                onPickServiceType={(id) => void onPickServiceType(id)}
                onPickPlan={(id) => void onPickPlan(id)}
              />
            </Panel>

            {loadingItems && <p style={{ color: colors.textDim }}>Loading plan items…</p>}

            {items.length > 0 && (
              <PcoItemList
                items={items}
                selectedCount={includedCount}
                selectableCount={selectableCount}
                importedCount={items.filter((i) => imported[i.id]?.length).length}
                onSelectAll={setAllIncluded}
                renderItem={(item) => {
                  const cfg = cfgs[item.id];
                  if (!cfg) return null;
                  return (
                    <PcoItemRow
                      key={item.id}
                      item={item}
                      preview={previews[item.id]}
                      importedIn={imported[item.id]}
                      cfg={cfg}
                      templates={templates}
                      template={templateCache[cfg.graphicTemplateId] ?? null}
                      onToggleInclude={() => patch(item.id, (c) => ({ ...c, include: !c.include }))}
                      translations={translations}
                      scriptureTranslation={effTranslation(cfg)}
                      onImportAs={(as) => setImportAs(item, as)}
                      onScriptureToggle={() => toggleScripture(item)}
                      onReference={(r) => patch(item.id, (c) => ({ ...c, reference: r }))}
                      onScriptureTranslation={(id) => {
                        setPickedTranslation(id);
                        rememberTranslation(id);
                        patch(item.id, (c) => ({ ...c, translation: id }));
                      }}
                      onScriptureTemplate={(id) =>
                        patch(item.id, (c) => ({ ...c, scriptureTemplateId: id }))
                      }
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
                }}
              />
            )}

            {creatingSongItems.length > 0 && (
              <Panel title={`New songs (${creatingSongItems.length})`}>
                <Stack gap={2}>
                  <p style={{ color: colors.textDim, fontSize: 12 }}>
                    These songs will be written to the library on import. Edit one to
                    set its templates, fields, sections and arrangement first.
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
                          <Pill tone={updatesExisting ? "warn" : "accent"}>
                            {updatesExisting ? "updates existing" : "creates new"}
                          </Pill>
                          {pv?.hasLyrics === false && (
                            <StatusDot tone="dim" label="no lyrics" />
                          )}
                          {pv?.lyricsFromArrangement && (
                            <StatusDot tone="good" label={`lyrics from ${pv.lyricsFromArrangement}`} />
                          )}
                          {customizedSongs.has(item.id) && (
                            <StatusDot tone="good" label="customized" />
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
                      <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
                    </Field>
                  ) : (
                    <>
                      <Field label="Existing show">
                        <Select value={existingShowId} onChange={(e) => setExistingShowId(e.target.value)}>
                          <option value="">Choose a show</option>
                          {showMetas.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Checkbox
                        checked={reorderToPlan}
                        onChange={setReorderToPlan}
                        label="Reorder rows from this plan to match Planning Center (rows you added by hand keep their place)"
                      />
                    </>
                  )}
                </Stack>
              </Panel>
            )}

            {error && (
              <p role="alert" style={{ color: colors.errorText }}>
                {error}
              </p>
            )}

            {result && (
              <Panel title={result.ok ? "Import complete" : "Import finished with errors"}>
                <Stack gap={2}>
                  <p style={{ color: colors.text }}>
                    {result.counts.rows} row(s) · {result.counts.songsCreated} song(s) created ·{" "}
                    {result.counts.songsLinked} linked · {result.counts.songsUpdated} updated
                  </p>
                  {result.reordered && (
                    <p style={{ color: colors.textDim, fontSize: 13 }}>Rows reordered to match the plan.</p>
                  )}
                  {!!result.removedRows?.length && (
                    <div style={{ fontSize: 13, color: colors.warn }}>
                      <TriangleAlert size={14} aria-hidden style={{ verticalAlign: "-2px" }} />{" "}
                      {result.removedRows.length} row{result.removedRows.length === 1 ? " is" : "s are"} no
                      longer in the Planning Center plan and {result.removedRows.length === 1 ? "was" : "were"} left in
                      the show for you to review:
                      <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                        {result.removedRows.map((r) => (
                          <li key={r.rowId}>{r.label ?? titleOf(r.itemId)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.warnings
                    .filter((w) => !(result.removedRows?.length && /removed from the plan/.test(w)))
                    .map((w, i) => (
                    <p key={i} style={{ color: colors.textDim, fontSize: 13 }}>
                      <TriangleAlert size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> {w}
                    </p>
                  ))}
                  {result.errors.map((e, i) => (
                    <p key={i} style={{ color: colors.errorText, fontSize: 13 }}>
                      {titleOf(e.itemId)}: {e.message}
                    </p>
                  ))}
                  {/* Deliberately not gated on `!result.ok`: the success path
                      normally navigates away, so this panel is only ever seen
                      when something went wrong — including when `openShow`
                      itself threw after a successful import. Without the
                      button that operator has no way into their new show. */}
                  {result.showId && (
                    <div>
                      <Button size="sm" onClick={() => void openShow(result.showId!)}>
                        Open show
                      </Button>
                    </div>
                  )}
                </Stack>
              </Panel>
            )}

            {items.length > 0 && (
              <PcoImportFooter
                summary={summary.label}
                canImport={canImport}
                importing={importing}
                onImport={() => void doImport()}
              />
            )}
          </Stack>
        )}
      </PageBody>
    </>
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
