"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  type Song, type Section,
  type SuggestedFieldMatch,
  listSongFieldDescriptors,
  suggestFieldMap,
} from "@overlaysys/core";
import { Button, Field, Input, Panel, Select, Textarea, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useDialog } from "@/lib/dialog";
import { AppHeader } from "@/app/components/AppHeader";
import { PageShell, PageBody } from "@/app/components/PageShell";
import { PasteLyricsModal } from "../PasteLyricsModal";
import { FieldMappingTable } from "./FieldMappingTable";
import { isCloudMode } from "@/lib/mode";
import {
  getSongCloud,
  getTemplateCloud,
  refreshSongMetasCloud,
  refreshTemplateMetasCloud,
  saveSongCloud,
} from "@/lib/cloudData";

// useSearchParams suspends during static prerender; wrapping it in a
// Suspense boundary lets Next.js's static export complete (the inner
// page hydrates with the real query string at runtime).
export default function SongEditorPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <SongEditorPageInner />
    </Suspense>
  );
}

function SongEditorPageInner() {
  const searchParams = useSearchParams();
  const id = decodeURIComponent(searchParams?.get("id") ?? "");
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const cached = useStore((s) => s.songCache[id]);
  const setSongInStore = useStore((s) => s.setSong);
  const templates = useStore((s) => s.templates);
  const templateCache = useStore((s) => s.templateCache);
  const setTemplate = useStore((s) => s.setTemplate);
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const channelConfigs = useStore((s) => s.channelConfigs);
  const channelChoices = useMemo(
    () => channelConfigs.filter((c) => !c.mirrorOf),
    [channelConfigs],
  );
  const [draft, setDraft] = useState<Song | null>(cached ?? null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [dragSecIdx, setDragSecIdx] = useState<number | null>(null);
  const [secDropZone, setSecDropZone] = useState<{ idx: number; pos: "before" | "after" } | null>(null);
  // Tracks which template-field keys the user has explicitly touched in the
  // intro / outro mapping tables. Suggested-but-unconfirmed rows show a pill
  // until the user either picks a value or clicks the pill to confirm.
  // Reset to empty whenever the corresponding template id changes — switching
  // templates discards old confirmations along with old mappings.
  const [introConfirmed, setIntroConfirmed] = useState<Set<string>>(() => new Set());
  const [outroConfirmed, setOutroConfirmed] = useState<Set<string>>(() => new Set());
  // Inline form state for adding an ad-hoc custom field.
  const [newFieldKey, setNewFieldKey] = useState("");
  const [newFieldError, setNewFieldError] = useState<string | null>(null);
  const { alert, dialog, confirm } = useDialog();
  const cloud = isCloudMode();

  async function showCloudError(action: string, err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.warn(`[songs/edit] cloud ${action} failed`, err);
    await alert({
      title: `Cloud ${action} failed`,
      message: (
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, margin: 0 }}>
          {message}
        </pre>
      ),
    });
  }

  function moveSection(from: number, to: number) {
    if (from === to) return;
    setDraft((d) => {
      if (!d) return d;
      const next = d.sections.slice();
      const [removed] = next.splice(from, 1);
      if (!removed) return d;
      const adjustedTo = from < to ? to - 1 : to;
      next.splice(adjustedTo, 0, removed);
      return { ...d, sections: next };
    });
  }

  useEffect(() => {
    if (cloud) {
      if (!cached) {
        getSongCloud(id)
          .then((s) => {
            if (s) {
              setSongInStore(s);
              setDraft(s);
            }
          })
          .catch((err) => console.warn("[songs/edit] cloud load failed", err));
      }
      if (templates.length === 0) {
        refreshTemplateMetasCloud().catch((err) =>
          console.warn("[songs/edit] template list failed", err),
        );
      }
      return;
    }
    if (conn === "open" && !cached) send({ type: "get_song", songId: id });
    if (conn === "open" && templates.length === 0) send({ type: "list_templates" });
  }, [cloud, conn, cached, id, send, templates.length, setSongInStore]);

  useEffect(() => {
    if (cached) setDraft(cached);
  }, [cached]);

  // Fetch full template payloads for the intro/outro defaults so we can show
  // the FieldMappingTable. The store keeps a separate `templates` (meta-only)
  // list for the picker dropdowns and a `templateCache` (full payload) for
  // editors — we need the latter for `template.fields`.
  //
  // Deps are narrowed to just the two template ids (plus WS/cloud state) so
  // typing in unrelated fields (e.g. the title input) doesn't re-fire this.
  // `templateCache` is intentionally read via a one-shot `useStore.getState()`
  // call instead of being a dep — a cache population shouldn't re-fire the
  // effect, and the in-flight `if (templateCache[id])` check below guards
  // against duplicate fetches on the next legitimate re-run.
  const introTplId = draft?.defaultIntroTemplateId;
  const outroTplId = draft?.defaultOutroTemplateId;
  useEffect(() => {
    const needed: string[] = [];
    if (introTplId) needed.push(introTplId);
    if (outroTplId) needed.push(outroTplId);
    if (needed.length === 0) return;
    const cacheNow = useStore.getState().templateCache;
    for (const templateId of needed) {
      if (cacheNow[templateId]) continue;
      if (cloud) {
        getTemplateCloud(templateId)
          .then((t) => {
            if (t) setTemplate(t);
          })
          .catch((err) =>
            console.warn(`[songs/edit] template ${templateId} load failed`, err),
          );
      } else if (conn === "open") {
        send({ type: "get_template", templateId });
      }
    }
  }, [introTplId, outroTplId, cloud, conn, send, setTemplate]);

  // Derived data for the Custom Fields + Defaults sections. The cheap pieces
  // (projectSchema, adHocKeys) recompute each render; the expensive ones
  // (listSongFieldDescriptors, suggestFieldMap) are memoized so typing in
  // unrelated inputs doesn't re-run them. All useMemo calls live ABOVE the
  // early-return below to keep hook order stable across renders.
  const projectSchema =
    projects.find((p) => p.id === currentProjectId)?.songCustomFieldSchema ?? [];
  const songFieldDescriptors = useMemo(
    () =>
      draft ? listSongFieldDescriptors(draft, projectSchema) : [],
    [draft, projects, currentProjectId],
  );
  const introTemplate = draft?.defaultIntroTemplateId
    ? templateCache[draft.defaultIntroTemplateId]
    : undefined;
  const outroTemplate = draft?.defaultOutroTemplateId
    ? templateCache[draft.defaultOutroTemplateId]
    : undefined;
  const introSuggestions: Record<string, SuggestedFieldMatch> = useMemo(
    () => (introTemplate ? suggestFieldMap(introTemplate.fields, songFieldDescriptors) : {}),
    [introTemplate, songFieldDescriptors],
  );
  const outroSuggestions: Record<string, SuggestedFieldMatch> = useMemo(
    () => (outroTemplate ? suggestFieldMap(outroTemplate.fields, songFieldDescriptors) : {}),
    [outroTemplate, songFieldDescriptors],
  );

  // One-shot seeding for the cold-cache scenario: changeSubTakeTemplate runs
  // while the template payload isn't in cache yet, the load effect later
  // populates it, and we want suggestions to appear automatically instead of
  // forcing the operator to re-pick the template. Re-running is guarded by
  // confirmedKeys being empty — once the user has touched any row (including
  // clearing it), we leave the map alone.
  useEffect(() => {
    if (!draft || !introTemplate) return;
    if (introConfirmed.size > 0) return;
    if (Object.keys(draft.defaultIntroFieldMap ?? {}).length > 0) return;
    const next: Record<string, string> = {};
    const exacts = new Set<string>();
    for (const [k, s] of Object.entries(introSuggestions)) {
      if (s.kind !== "none") next[k] = s.songFieldKey;
      if (s.kind === "exact") exacts.add(k);
    }
    if (Object.keys(next).length === 0) return;
    setDraft((d) => (d ? { ...d, defaultIntroFieldMap: next } : d));
    setIntroConfirmed(exacts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- introSuggestions/confirmed/draft are checked above; seeding fires only on the cold→warm transition
  }, [introTemplate]);
  useEffect(() => {
    if (!draft || !outroTemplate) return;
    if (outroConfirmed.size > 0) return;
    if (Object.keys(draft.defaultOutroFieldMap ?? {}).length > 0) return;
    const next: Record<string, string> = {};
    const exacts = new Set<string>();
    for (const [k, s] of Object.entries(outroSuggestions)) {
      if (s.kind !== "none") next[k] = s.songFieldKey;
      if (s.kind === "exact") exacts.add(k);
    }
    if (Object.keys(next).length === 0) return;
    setDraft((d) => (d ? { ...d, defaultOutroFieldMap: next } : d));
    setOutroConfirmed(exacts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirror of intro seeding effect above
  }, [outroTemplate]);

  if (!draft) return <div style={{ padding: 24 }}>Loading…</div>;

  function setMeta<K extends keyof Song>(key: K, value: Song[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  const projectSchemaKeyMap = new Map(projectSchema.map((f) => [f.key, f]));
  const adHocKeys = Object.keys(draft.customFields)
    .filter((k) => !projectSchemaKeyMap.has(k))
    .sort();

  function addAdHocField() {
    const key = newFieldKey.trim();
    if (!key) {
      setNewFieldError("Key required");
      return;
    }
    const lower = key.toLowerCase();
    const allKeys = [
      ...projectSchema.map((f) => f.key),
      ...Object.keys(draft!.customFields),
    ];
    if (allKeys.some((k) => k.toLowerCase() === lower)) {
      setNewFieldError("Key already exists");
      return;
    }
    setCustomField(key, "");
    setNewFieldKey("");
    setNewFieldError(null);
  }

  function updateSection(idx: number, patch: Partial<Section>) {
    setDraft((d) => {
      if (!d) return d;
      const next = d.sections.slice();
      const target = next[idx];
      if (!target) return d;
      next[idx] = { ...target, ...patch };
      return { ...d, sections: next };
    });
  }

  function updateSlide(secIdx: number, slideIdx: number, lines: string[]) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.slice();
      const sec = sections[secIdx];
      if (!sec) return d;
      const slides = sec.slides.slice();
      const target = slides[slideIdx];
      if (!target) return d;
      slides[slideIdx] = { ...target, lines };
      sections[secIdx] = { ...sec, slides };
      return { ...d, sections };
    });
  }

  function addSlide(secIdx: number) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.slice();
      const sec = sections[secIdx];
      if (!sec) return d;
      sections[secIdx] = {
        ...sec,
        slides: [...sec.slides, { id: `${sec.id}s${sec.slides.length + 1}`, lines: [""] }],
      };
      return { ...d, sections };
    });
  }

  function removeSlide(secIdx: number, slideIdx: number) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.slice();
      const sec = sections[secIdx];
      if (!sec) return d;
      if (sec.slides.length <= 1) return d;
      sections[secIdx] = { ...sec, slides: sec.slides.filter((_, i) => i !== slideIdx) };
      return { ...d, sections };
    });
  }

  function addSection(kind: Section["kind"] = "verse") {
    setDraft((d) => {
      if (!d) return d;
      // Generate a unique kind-prefixed id by counting existing sections of
      // the same kind. Falls back to a numeric suffix on collision so it
      // works even when the song was authored with hand-picked ids.
      const prefix = SECTION_ID_PREFIX[kind];
      const sameKindCount = d.sections.filter((s) => s.kind === kind).length;
      let n = sameKindCount + 1;
      let id = `${prefix}${n}`;
      while (d.sections.some((s) => s.id === id)) {
        n += 1;
        id = `${prefix}${n}`;
      }
      const label = `${KIND_LABEL[kind]} ${n}`;
      const newSection: Section = {
        id,
        kind,
        label,
        slides: [{ id: `${id}s1`, lines: [""] }],
      };
      return { ...d, sections: [...d.sections, newSection] };
    });
  }

  async function removeSection(secIdx: number) {
    const sec = draft?.sections[secIdx];
    if (!sec) return;
    const arrangementUses = (draft?.defaultArrangement ?? []).filter(
      (sid) => sid === sec.id,
    ).length;
    const ok = await confirm({
      title: "Delete section?",
      destructive: true,
      confirmLabel: "Delete",
      message: (
        <>
          <p style={{ margin: 0 }}>
            Delete <strong>{sec.label}</strong>{" "}
            <span style={{ color: colors.textDim, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
              ({sec.id})
            </span>{" "}
            and its {sec.slides.length} slide{sec.slides.length === 1 ? "" : "s"}?
          </p>
          {arrangementUses > 0 && (
            <p style={{ marginTop: 8, marginBottom: 0, color: colors.textDim, fontSize: 12 }}>
              This section appears {arrangementUses} time{arrangementUses === 1 ? "" : "s"} in
              the default arrangement and will be removed from there too.
            </p>
          )}
        </>
      ),
    });
    if (!ok) return;
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.filter((_, i) => i !== secIdx);
      const defaultArrangement = d.defaultArrangement.filter((sid) => sid !== sec.id);
      return { ...d, sections, defaultArrangement };
    });
  }

  function setCustomField(key: string, value: string) {
    setDraft((d) =>
      d ? { ...d, customFields: { ...d.customFields, [key]: value } } : d,
    );
  }

  function removeCustomField(key: string) {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d.customFields };
      delete next[key];
      return { ...d, customFields: next };
    });
  }

  /**
   * Switches the intro/outro template and re-seeds the field map from
   * `suggestFieldMap` against the new template. Any prior manual confirmations
   * are discarded — the user can re-touch any incorrect suggestions. This
   * keeps the UX simple at the cost of losing the user's previous picks; a
   * future iteration could add a "keep my picks" confirm prompt.
   */
  function changeSubTakeTemplate(
    which: "intro" | "outro",
    templateId: string | undefined,
  ) {
    if (!draft) return;
    // We only have fields if the full template payload is in the cache. When
    // it isn't yet, save just the templateId and leave the map empty — the
    // load-template effect will fetch it and the user can re-pick to seed
    // suggestions. In practice the cache is warm for any template the user
    // saw in the dropdown long enough to click.
    const tpl = templateId ? templateCache[templateId] : undefined;
    const songFields = listSongFieldDescriptors(
      draft,
      projects.find((p) => p.id === currentProjectId)?.songCustomFieldSchema,
    );
    const suggestions = tpl ? suggestFieldMap(tpl.fields, songFields) : {};
    const nextMap: Record<string, string> = {};
    for (const [key, s] of Object.entries(suggestions)) {
      if (s.kind !== "none") nextMap[key] = s.songFieldKey;
    }
    // Normalize empty maps to undefined: schema is .optional() and we want
    // "absent" rather than "explicitly empty" to be the canonical form.
    const persistedMap =
      templateId && Object.keys(nextMap).length > 0 ? nextMap : undefined;
    setDraft((d) => {
      if (!d) return d;
      if (which === "intro") {
        return {
          ...d,
          defaultIntroTemplateId: templateId,
          defaultIntroFieldMap: persistedMap,
        };
      }
      return {
        ...d,
        defaultOutroTemplateId: templateId,
        defaultOutroFieldMap: persistedMap,
      };
    });
    // Exact-match rows don't need confirmation; they render the ✓ indicator.
    // Treat them as confirmed-by-default so the parent state is consistent
    // (clicking them later is a no-op).
    const exacts = new Set<string>();
    for (const [k, s] of Object.entries(suggestions)) {
      if (s.kind === "exact") exacts.add(k);
    }
    if (which === "intro") setIntroConfirmed(exacts);
    else setOutroConfirmed(exacts);
  }

  async function save() {
    if (!draft) return;
    if (cloud) {
      try {
        await saveSongCloud(draft);
        await refreshSongMetasCloud();
        setSongInStore(draft);
      } catch (err) {
        await showCloudError("save", err);
      }
      return;
    }
    send({ type: "save_song", song: draft });
  }

  return (
    <PageShell>
      <AppHeader
        context={
          <h1 style={{ margin: 0, fontSize: 16 }}>
            ♪ {draft.title || <span style={{ color: colors.textDim, fontStyle: "italic" }}>(untitled)</span>}
          </h1>
        }
        actions={
          <>
            <Button onClick={() => setPasteOpen((v) => !v)} size="sm">Paste lyrics…</Button>
            <Button onClick={save} variant="primary" size="sm">Save</Button>
          </>
        }
      />
      <PageBody maxWidth={1100}>

      {pasteOpen && draft && (
        <PasteLyricsModal
          song={draft}
          onApply={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
          onClose={() => setPasteOpen(false)}
        />
      )}

      <Panel title="Metadata" padding="md" style={{ marginBottom: 16 }}>
        <Field label="Title" layout="inline">
          <Input value={draft.title} onChange={(e) => setMeta("title", e.target.value)} />
        </Field>
        <Field label="Author" layout="inline">
          <Input value={draft.author ?? ""} onChange={(e) => setMeta("author", e.target.value || undefined)} />
        </Field>
        <Field label="CCLI #" layout="inline">
          <Input value={draft.ccliNumber ?? ""} onChange={(e) => setMeta("ccliNumber", e.target.value || undefined)} />
        </Field>
        <Field label="Copyright" layout="inline">
          <Input value={draft.copyright ?? ""} onChange={(e) => setMeta("copyright", e.target.value || undefined)} />
        </Field>
        <Field
          label="Template"
          layout="inline"
          hint="Default template used when this song is added to a show. Show rows can override per-row."
        >
          <Select
            value={draft.defaultLyricTemplateId ?? ""}
            onChange={(e) => setMeta("defaultLyricTemplateId", e.target.value || undefined)}
          >
            <option value="">(none — pick per show row)</option>
            {!!draft.defaultLyricTemplateId &&
              !templates.some((t) => t.id === draft.defaultLyricTemplateId) && (
                <option value={draft.defaultLyricTemplateId}>
                  {draft.defaultLyricTemplateId} (missing)
                </option>
              )}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
      </Panel>

      <Panel title="Custom Fields" padding="md" style={{ marginBottom: 16 }}>
        {projectSchema.length === 0 && adHocKeys.length === 0 && (
          <p style={{ fontSize: 12, color: colors.textDim, fontStyle: "italic", marginBottom: 8 }}>
            No project-defined fields. Use “+ Add field” below to attach
            song-specific data (e.g. hymn number, vocal arrangement).
          </p>
        )}
        {projectSchema.map((f) => (
          <Field key={f.key} label={f.label} layout="inline">
            <Input
              type={f.type === "number" ? "number" : "text"}
              value={draft.customFields[f.key] ?? ""}
              onChange={(e) => setCustomField(f.key, e.target.value)}
            />
          </Field>
        ))}
        {adHocKeys.length > 0 && (
          <div
            style={{
              borderTop:
                projectSchema.length > 0
                  ? `1px solid ${colors.border}`
                  : undefined,
              paddingTop: projectSchema.length > 0 ? 8 : 0,
              marginTop: projectSchema.length > 0 ? 8 : 0,
            }}
          >
            {adHocKeys.map((k) => (
              <Field key={k} label={k} layout="inline">
                <div style={{ display: "flex", gap: 8 }}>
                  <Input
                    value={draft.customFields[k] ?? ""}
                    onChange={(e) => setCustomField(k, e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <Button
                    onClick={() => removeCustomField(k)}
                    size="sm"
                    title="Remove this field"
                  >
                    ×
                  </Button>
                </div>
              </Field>
            ))}
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginTop: 8,
            paddingTop: 8,
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          <Input
            value={newFieldKey}
            placeholder="new field key (e.g. vocal_arrangement)"
            onChange={(e) => {
              // Soft-normalise like CustomFieldSchemaModal — lowercase + spaces→_.
              setNewFieldKey(e.target.value.toLowerCase().replace(/\s+/g, "_"));
              if (newFieldError) setNewFieldError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addAdHocField();
              }
            }}
            invalid={!!newFieldError}
            style={{ flex: 1 }}
          />
          <Button onClick={addAdHocField} size="sm">+ Add field</Button>
        </div>
        {newFieldError && (
          <div style={{ marginTop: 4, fontSize: 11, color: colors.errorText }}>
            {newFieldError}
          </div>
        )}
      </Panel>

      <Panel title="Defaults" padding="md" style={{ marginBottom: 16 }}>
        <Field
          label="Intro template"
          layout="inline"
          hint="Played before the song's lyrics. Show rows can override per-row."
        >
          <Select
            value={draft.defaultIntroTemplateId ?? ""}
            onChange={(e) =>
              changeSubTakeTemplate("intro", e.target.value || undefined)
            }
          >
            <option value="">(none — skip intro by default)</option>
            {!!draft.defaultIntroTemplateId &&
              !templates.some((t) => t.id === draft.defaultIntroTemplateId) && (
                <option value={draft.defaultIntroTemplateId}>
                  {draft.defaultIntroTemplateId} (missing)
                </option>
              )}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
        {introTemplate && (
          <div style={{ marginLeft: 108, marginBottom: 12 }}>
            <FieldMappingTable
              templateFields={introTemplate.fields}
              songFields={songFieldDescriptors}
              value={draft.defaultIntroFieldMap ?? {}}
              literals={draft.defaultIntroFieldLiterals ?? {}}
              suggestions={introSuggestions}
              confirmedKeys={introConfirmed}
              onChange={(next) =>
                setMeta(
                  "defaultIntroFieldMap",
                  Object.keys(next).length === 0 ? undefined : next,
                )
              }
              onLiteralsChange={(next) =>
                setMeta(
                  "defaultIntroFieldLiterals",
                  Object.keys(next).length === 0 ? undefined : next,
                )
              }
              onConfirm={(key) =>
                setIntroConfirmed((prev) => {
                  if (prev.has(key)) return prev;
                  const next = new Set(prev);
                  next.add(key);
                  return next;
                })
              }
            />
          </div>
        )}

        <Field
          label="Outro template"
          layout="inline"
          hint="Played after the song's lyrics. Show rows can override per-row."
        >
          <Select
            value={draft.defaultOutroTemplateId ?? ""}
            onChange={(e) =>
              changeSubTakeTemplate("outro", e.target.value || undefined)
            }
          >
            <option value="">(none — skip outro by default)</option>
            {!!draft.defaultOutroTemplateId &&
              !templates.some((t) => t.id === draft.defaultOutroTemplateId) && (
                <option value={draft.defaultOutroTemplateId}>
                  {draft.defaultOutroTemplateId} (missing)
                </option>
              )}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
        {outroTemplate && (
          <div style={{ marginLeft: 108, marginBottom: 12 }}>
            <FieldMappingTable
              templateFields={outroTemplate.fields}
              songFields={songFieldDescriptors}
              value={draft.defaultOutroFieldMap ?? {}}
              literals={draft.defaultOutroFieldLiterals ?? {}}
              suggestions={outroSuggestions}
              confirmedKeys={outroConfirmed}
              onChange={(next) =>
                setMeta(
                  "defaultOutroFieldMap",
                  Object.keys(next).length === 0 ? undefined : next,
                )
              }
              onLiteralsChange={(next) =>
                setMeta(
                  "defaultOutroFieldLiterals",
                  Object.keys(next).length === 0 ? undefined : next,
                )
              }
              onConfirm={(key) =>
                setOutroConfirmed((prev) => {
                  if (prev.has(key)) return prev;
                  const next = new Set(prev);
                  next.add(key);
                  return next;
                })
              }
            />
          </div>
        )}

        <Field
          label="Default channel"
          layout="inline"
          hint="Picked first when no row or show overrides it. Falls through to the lyric template's default if unset."
        >
          <Select
            value={draft.defaultChannel ?? ""}
            onChange={(e) =>
              setMeta("defaultChannel", e.target.value || undefined)
            }
          >
            <option value="">(none)</option>
            {/* Preserve out-of-list values so a previously-saved channel that
                was deleted or hidden still shows up rather than silently
                dropping. */}
            {draft.defaultChannel &&
              !channelChoices.some((c) => c.id === draft.defaultChannel) && (
                <option value={draft.defaultChannel}>
                  {draft.defaultChannel} (missing)
                </option>
              )}
            {channelChoices.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
      </Panel>

      <h2 style={{ fontSize: 14, marginBottom: 8 }}>Sections</h2>
      {draft.sections.length === 0 && (
        <p style={{ fontSize: 12, color: colors.textDim, fontStyle: "italic", marginBottom: 12 }}>
          No sections yet. Add one below or paste lyrics.
        </p>
      )}
      {draft.sections.map((sec, secIdx) => {
        const isDragging = dragSecIdx === secIdx;
        const dropAtMe = secDropZone?.idx === secIdx ? secDropZone.pos : null;
        return (
          <div
            key={sec.id}
            onDragOver={(e) => {
              if (dragSecIdx === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const pos: "before" | "after" =
                e.clientY < r.top + r.height / 2 ? "before" : "after";
              setSecDropZone({ idx: secIdx, pos });
            }}
            onDragLeave={(e) => {
              // Only clear when leaving the wrapper itself, not children.
              if (e.currentTarget === e.target) setSecDropZone(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const sourceIdxStr = e.dataTransfer.getData("text/plain");
              const sourceIdx = Number(sourceIdxStr);
              const z = secDropZone;
              setSecDropZone(null);
              setDragSecIdx(null);
              if (Number.isNaN(sourceIdx) || !z) return;
              const target = z.pos === "before" ? z.idx : z.idx + 1;
              moveSection(sourceIdx, target);
            }}
            style={{
              marginBottom: 16,
              // Raw 2px borders here are intentional drop indicators —
              // not the standardized radius/border tokens.
              borderTop: dropAtMe === "before" ? `2px solid ${colors.green}` : "2px solid transparent",
              borderBottom: dropAtMe === "after" ? `2px solid ${colors.green}` : "2px solid transparent",
              opacity: isDragging ? 0.5 : 1,
            }}
          >
            <Panel padding="md">
              <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                <span
                  draggable
                  onDragStart={(e) => {
                    setDragSecIdx(secIdx);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(secIdx));
                  }}
                  onDragEnd={() => {
                    setDragSecIdx(null);
                    setSecDropZone(null);
                  }}
                  title="Drag to reorder section"
                  aria-label="Drag handle"
                  style={{
                    cursor: "grab",
                    color: colors.textDim,
                    fontSize: 16,
                    padding: "0 4px",
                    userSelect: "none",
                  }}
                >
                  ⋮⋮
                </span>
                <Input
                  value={sec.label}
                  onChange={(e) => updateSection(secIdx, { label: e.target.value })}
                  style={{ fontWeight: 600, flex: 1 }}
                />
                <Select
                  value={sec.kind}
                  onChange={(e) => updateSection(secIdx, { kind: e.target.value as Section["kind"] })}
                  style={{ width: "auto" }}
                >
                  <option value="verse">verse</option>
                  <option value="chorus">chorus</option>
                  <option value="bridge">bridge</option>
                  <option value="tag">tag</option>
                  <option value="intro">intro</option>
                  <option value="outro">outro</option>
                  <option value="other">other</option>
                </Select>
                <span style={{ fontSize: 10, color: colors.textDim, fontFamily: "ui-monospace, monospace" }}>
                  {sec.id}
                </span>
                <Button
                  onClick={() => removeSection(secIdx)}
                  variant="destructive"
                  size="sm"
                  title="Delete section"
                >
                  Delete section
                </Button>
              </div>
              {sec.slides.map((slide, slideIdx) => (
                <div key={slide.id} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <Textarea
                    value={slide.lines.join("\n")}
                    onChange={(e) => updateSlide(secIdx, slideIdx, e.target.value.split("\n"))}
                    rows={2}
                    mono
                    style={{ flex: 1 }}
                  />
                  <Button onClick={() => removeSlide(secIdx, slideIdx)} size="sm" disabled={sec.slides.length <= 1}>
                    ✕
                  </Button>
                </div>
              ))}
              <Button onClick={() => addSlide(secIdx)} size="sm">+ Slide</Button>
            </Panel>
          </div>
        );
      })}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Button onClick={() => addSection("verse")} size="sm">+ Verse</Button>
        <Button onClick={() => addSection("chorus")} size="sm">+ Chorus</Button>
        <Button onClick={() => addSection("bridge")} size="sm">+ Bridge</Button>
        <Select
          value=""
          onChange={(e) => {
            const v = e.target.value as Section["kind"] | "";
            if (!v) return;
            addSection(v);
            e.currentTarget.value = "";
          }}
          style={{ width: "auto" }}
        >
          <option value="">+ Other section…</option>
          <option value="tag">Tag</option>
          <option value="intro">Intro</option>
          <option value="outro">Outro</option>
          <option value="other">Other</option>
        </Select>
      </div>

      <Panel title="Default Arrangement" padding="md" style={{ marginBottom: 16 }}>
        <ArrangementEditor
          arrangement={draft.defaultArrangement}
          sections={draft.sections}
          onChange={(next) => setMeta("defaultArrangement", next)}
        />
        <p style={{ fontSize: 10, color: colors.textDim, marginTop: 4 }}>
          Sections can repeat. Drag chips to reorder.
        </p>
      </Panel>
      </PageBody>
      {dialog}
    </PageShell>
  );
}

const SECTION_ID_PREFIX: Record<Section["kind"], string> = {
  verse: "v",
  chorus: "c",
  bridge: "b",
  tag: "tag",
  intro: "intro",
  outro: "outro",
  other: "s",
};

const KIND_LABEL: Record<Section["kind"], string> = {
  verse: "Verse",
  chorus: "Chorus",
  bridge: "Bridge",
  tag: "Tag",
  intro: "Intro",
  outro: "Outro",
  other: "Section",
};

function ArrangementEditor({
  arrangement,
  sections,
  onChange,
}: {
  arrangement: string[];
  sections: Section[];
  onChange: (next: string[]) => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropZone, setDropZone] = useState<{ idx: number; pos: "before" | "after" } | null>(null);

  function move(from: number, to: number) {
    if (from === to) return;
    const next = arrangement.slice();
    const [removed] = next.splice(from, 1);
    if (removed === undefined) return;
    const adjustedTo = from < to ? to - 1 : to;
    next.splice(adjustedTo, 0, removed);
    onChange(next);
  }
  function remove(idx: number) {
    onChange(arrangement.filter((_, i) => i !== idx));
  }
  function add(sectionId: string) {
    onChange([...arrangement, sectionId]);
  }

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
        {arrangement.length === 0 && (
          <p style={{ color: colors.textDim, fontSize: 12, fontStyle: "italic" }}>
            Empty arrangement. Add sections below.
          </p>
        )}
        {arrangement.map((sectionId, i) => {
          const section = sections.find((s) => s.id === sectionId);
          const isDragging = dragIdx === i;
          const dropAtMe = dropZone?.idx === i ? dropZone.pos : null;
          return (
            <div
              key={`${sectionId}@${i}`}
              draggable
              onDragStart={(e) => {
                setDragIdx(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const pos: "before" | "after" = e.clientY < r.top + r.height / 2 ? "before" : "after";
                setDropZone({ idx: i, pos });
              }}
              onDragLeave={() => setDropZone(null)}
              onDrop={(e) => {
                e.preventDefault();
                const sourceIdxStr = e.dataTransfer.getData("text/plain");
                const sourceIdx = Number(sourceIdxStr);
                const z = dropZone;
                setDropZone(null);
                if (Number.isNaN(sourceIdx) || !z) return;
                const target = z.pos === "before" ? z.idx : z.idx + 1;
                move(sourceIdx, target);
              }}
              onDragEnd={() => { setDragIdx(null); setDropZone(null); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 4,
                border: `1px solid ${colors.border}`,
                background: colors.panel2,
                opacity: isDragging ? 0.5 : 1,
                // Raw 2px borders here are intentional drag indicators —
                // not the standardized radius/border tokens.
                borderTop: dropAtMe === "before" ? `2px solid ${colors.green}` : undefined,
                borderBottom: dropAtMe === "after" ? `2px solid ${colors.green}` : `1px solid ${colors.border}`,
                cursor: "grab",
                fontSize: 12,
              }}
            >
              <span style={{ color: colors.textDim, width: 24, textAlign: "right" }}>{i + 1}.</span>
              <span aria-hidden style={{ color: colors.textDim }}>⋮⋮</span>
              <span style={{ fontWeight: 600 }}>{section?.label ?? sectionId}</span>
              <span style={{ fontSize: 10, color: colors.textDim, fontFamily: "ui-monospace, monospace" }}>
                {sectionId}{!section && " (missing)"}
              </span>
              <button
                onClick={() => remove(i)}
                title="Remove"
                style={{
                  marginLeft: "auto",
                  padding: "2px 8px",
                  background: "transparent",
                  color: colors.textDim,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 3,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <Select
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (v) add(v);
          e.currentTarget.value = "";
        }}
        style={{ width: "auto" }}
      >
        <option value="">+ Add section…</option>
        {sections.map((s) => (
          <option key={s.id} value={s.id}>{s.label} ({s.id})</option>
        ))}
      </Select>
    </div>
  );
}
