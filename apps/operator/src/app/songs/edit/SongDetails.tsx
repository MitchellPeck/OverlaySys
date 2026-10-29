"use client";

import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  type Song,
  type SuggestedFieldMatch,
  type TemplateMeta,
  listSongFieldDescriptors,
  suggestFieldMap,
} from "@overlaysys/core";
import { Button, IconButton, Input, Select, colors, useToast } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { isCloudMode } from "@/lib/mode";
import { getTemplateCloud } from "@/lib/cloudData";
import { templatesFor, type TemplateUse } from "@/lib/templateRoles";
import { FieldMappingTable } from "./FieldMappingTable";
import { customFieldKey, outputChannelGroups } from "./songEditorModel";

const labelStyle = { fontSize: 11, color: colors.textDim } as const;

function Row({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <label htmlFor={htmlFor} style={labelStyle}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: colors.textMuted }}>{hint}</div>}
    </div>
  );
}

/** Template picker: templates suited to `use` first, the rest under "Other templates". */
function TemplateSelect(p: {
  id: string;
  value: string | undefined;
  use: TemplateUse;
  noneLabel: string;
  templates: TemplateMeta[];
  onChange(id: string | undefined): void;
}) {
  const { suggested, others } = templatesFor(p.templates, p.use);
  const missing = !!p.value && !p.templates.some((t) => t.id === p.value);
  return (
    <Select id={p.id} value={p.value ?? ""} onChange={(e) => p.onChange(e.target.value || undefined)} style={{ width: "100%" }}>
      <option value="">{p.noneLabel}</option>
      {missing && <option value={p.value}>{p.value} (missing)</option>}
      {suggested.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
      {others.length > 0 && (
        <optgroup label="Other templates">
          {others.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}

/**
 * Collapsible "Details" group of the song editor: templates, intro/outro field
 * mapping, default output, credits and custom fields.
 */
export function SongDetails({
  draft,
  onChange,
  defaultOpen = true,
}: {
  draft: Song;
  onChange: Dispatch<SetStateAction<Song>>;
  defaultOpen?: boolean;
}) {
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const templates = useStore((s) => s.templates);
  const templateCache = useStore((s) => s.templateCache);
  const setTemplate = useStore((s) => s.setTemplate);
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const channelConfigs = useResolvedChannelConfigs();
  const channels = useMemo(() => outputChannelGroups(channelConfigs), [channelConfigs]);
  const toast = useToast();
  const cloud = isCloudMode();
  const [open, setOpen] = useState(defaultOpen);
  // Template-field keys the user has touched in the intro / outro mapping
  // tables; suggested-but-unconfirmed rows show a pill until then. Reset when
  // the template changes.
  const [introConfirmed, setIntroConfirmed] = useState<Set<string>>(() => new Set());
  const [outroConfirmed, setOutroConfirmed] = useState<Set<string>>(() => new Set());
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldError, setNewFieldError] = useState<string | null>(null);

  // Full template payloads for the intro/outro defaults (FieldMappingTable
  // needs `fields`). The cache is read one-shot so a cache fill doesn't re-fire.
  const introTplId = draft.defaultIntroTemplateId;
  const outroTplId = draft.defaultOutroTemplateId;
  useEffect(() => {
    const needed: string[] = [];
    if (introTplId) needed.push(introTplId);
    if (outroTplId) needed.push(outroTplId);
    const cacheNow = useStore.getState().templateCache;
    for (const templateId of needed) {
      if (cacheNow[templateId]) continue;
      if (cloud) {
        getTemplateCloud(templateId)
          .then((t) => {
            if (t) setTemplate(t);
          })
          .catch((err) => console.warn(`[songs/edit] template ${templateId} load failed`, err));
      } else if (conn === "open") {
        send({ type: "get_template", templateId });
      }
    }
  }, [introTplId, outroTplId, cloud, conn, send, setTemplate]);

  const projectSchema = projects.find((p) => p.id === currentProjectId)?.songCustomFieldSchema ?? [];
  const songFieldDescriptors = useMemo(
    () => listSongFieldDescriptors(draft, projectSchema),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projectSchema derives from projects/currentProjectId
    [draft, projects, currentProjectId],
  );
  const introTemplate = introTplId ? templateCache[introTplId] : undefined;
  const outroTemplate = outroTplId ? templateCache[outroTplId] : undefined;
  const introSuggestions: Record<string, SuggestedFieldMatch> = useMemo(
    () => (introTemplate ? suggestFieldMap(introTemplate.fields, songFieldDescriptors) : {}),
    [introTemplate, songFieldDescriptors],
  );
  const outroSuggestions: Record<string, SuggestedFieldMatch> = useMemo(
    () => (outroTemplate ? suggestFieldMap(outroTemplate.fields, songFieldDescriptors) : {}),
    [outroTemplate, songFieldDescriptors],
  );

  // Cold-cache seeding: when a picked template's payload arrives later, fill
  // its suggestions once, unless the user already touched a row or a map exists.
  useEffect(() => {
    if (!introTemplate || introConfirmed.size > 0) return;
    if (Object.keys(draft.defaultIntroFieldMap ?? {}).length > 0) return;
    const { map, exacts } = seed(introSuggestions);
    if (Object.keys(map).length === 0) return;
    onChange((d) => ({ ...d, defaultIntroFieldMap: map }));
    setIntroConfirmed(exacts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeding fires only on the cold→warm transition
  }, [introTemplate]);
  useEffect(() => {
    if (!outroTemplate || outroConfirmed.size > 0) return;
    if (Object.keys(draft.defaultOutroFieldMap ?? {}).length > 0) return;
    const { map, exacts } = seed(outroSuggestions);
    if (Object.keys(map).length === 0) return;
    onChange((d) => ({ ...d, defaultOutroFieldMap: map }));
    setOutroConfirmed(exacts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirror of the intro seeding effect
  }, [outroTemplate]);

  function setMeta<K extends keyof Song>(key: K, value: Song[K]) {
    onChange((d) => ({ ...d, [key]: value }));
  }

  /** Switch the intro/outro template and re-seed its map from the suggestions. */
  function changeSubTakeTemplate(which: "intro" | "outro", templateId: string | undefined) {
    const tpl = templateId ? templateCache[templateId] : undefined;
    const suggestions = tpl ? suggestFieldMap(tpl.fields, listSongFieldDescriptors(draft, projectSchema)) : {};
    const { map, exacts } = seed(suggestions);
    const persistedMap = templateId && Object.keys(map).length > 0 ? map : undefined;
    onChange((d) =>
      which === "intro"
        ? { ...d, defaultIntroTemplateId: templateId, defaultIntroFieldMap: persistedMap }
        : { ...d, defaultOutroTemplateId: templateId, defaultOutroFieldMap: persistedMap },
    );
    if (which === "intro") setIntroConfirmed(exacts);
    else setOutroConfirmed(exacts);
  }

  const schemaKeys = new Set(projectSchema.map((f) => f.key));
  const adHocKeys = Object.keys(draft.customFields).filter((k) => !schemaKeys.has(k)).sort();

  function setCustomField(key: string, value: string) {
    onChange((d) => ({ ...d, customFields: { ...d.customFields, [key]: value } }));
  }

  function addCustomField() {
    const r = customFieldKey(newFieldLabel, [...projectSchema.map((f) => f.key), ...Object.keys(draft.customFields)]);
    if ("error" in r) {
      setNewFieldError(r.error);
      return;
    }
    setCustomField(r.key, "");
    setNewFieldLabel("");
    setNewFieldError(null);
  }

  function removeCustomField(key: string) {
    const prev = draft.customFields[key] ?? "";
    onChange((d) => {
      const next = { ...d.customFields };
      delete next[key];
      return { ...d, customFields: next };
    });
    toast({
      message: `Removed field “${key}”`,
      action: { label: "Undo", onClick: () => setCustomField(key, prev) },
    });
  }

  function mappingTable(which: "intro" | "outro") {
    const tpl = which === "intro" ? introTemplate : outroTemplate;
    if (!tpl) return null;
    const mapKey = which === "intro" ? "defaultIntroFieldMap" : "defaultOutroFieldMap";
    const litKey = which === "intro" ? "defaultIntroFieldLiterals" : "defaultOutroFieldLiterals";
    const setConfirmed = which === "intro" ? setIntroConfirmed : setOutroConfirmed;
    return (
      <FieldMappingTable
        templateFields={tpl.fields}
        songFields={songFieldDescriptors}
        value={draft[mapKey] ?? {}}
        literals={draft[litKey] ?? {}}
        suggestions={which === "intro" ? introSuggestions : outroSuggestions}
        confirmedKeys={which === "intro" ? introConfirmed : outroConfirmed}
        onChange={(next) => setMeta(mapKey, Object.keys(next).length === 0 ? undefined : next)}
        onLiteralsChange={(next) => setMeta(litKey, Object.keys(next).length === 0 ? undefined : next)}
        onConfirm={(key) =>
          setConfirmed((prev) => {
            if (prev.has(key)) return prev;
            const next = new Set(prev);
            next.add(key);
            return next;
          })
        }
      />
    );
  }

  const channelIsStage = !!draft.defaultChannel && channels.stage.some((c) => c.id === draft.defaultChannel);
  const channelMissing =
    !!draft.defaultChannel &&
    !channels.program.some((c) => c.id === draft.defaultChannel) &&
    !channelIsStage;
  const idp = `song-${draft.id}`;

  return (
    <section style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            minHeight: 24,
            padding: 0,
            border: 0,
            background: "transparent",
            color: colors.text,
            font: "inherit",
            cursor: "pointer",
          }}
        >
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          Details
        </button>
      </h2>
      {open && (
        <>
          <Row label="Lyric template" htmlFor={`${idp}-lyric`} hint="Used when this song is added to a show. A show row can pick another.">
            <TemplateSelect
              id={`${idp}-lyric`}
              value={draft.defaultLyricTemplateId}
              use="lyric"
              noneLabel="(none — pick per show row)"
              templates={templates}
              onChange={(v) => setMeta("defaultLyricTemplateId", v)}
            />
          </Row>
          <Row label="Intro" htmlFor={`${idp}-intro`} hint="Shown before the lyrics.">
            <TemplateSelect
              id={`${idp}-intro`}
              value={introTplId}
              use="title"
              noneLabel="(no intro)"
              templates={templates}
              onChange={(v) => changeSubTakeTemplate("intro", v)}
            />
          </Row>
          {mappingTable("intro")}
          <Row label="Outro" htmlFor={`${idp}-outro`} hint="Shown after the lyrics.">
            <TemplateSelect
              id={`${idp}-outro`}
              value={outroTplId}
              use="title"
              noneLabel="(no outro)"
              templates={templates}
              onChange={(v) => changeSubTakeTemplate("outro", v)}
            />
          </Row>
          {mappingTable("outro")}
          <Row
            label="Default output"
            htmlFor={`${idp}-channel`}
            hint={channelIsStage ? "Lyrics on a stage display only" : "Used when the show row doesn't pick one."}
          >
            <Select
              id={`${idp}-channel`}
              value={draft.defaultChannel ?? ""}
              onChange={(e) => setMeta("defaultChannel", e.target.value || undefined)}
              style={{ width: "100%" }}
            >
              <option value="">(lyric template’s default)</option>
              {channelMissing && <option value={draft.defaultChannel}>{draft.defaultChannel} (missing)</option>}
              {channels.program.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {channels.stage.length > 0 && (
                <optgroup label="Stage">
                  {channels.stage.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </Row>
          <Row label="Author" htmlFor={`${idp}-author`}>
            <Input id={`${idp}-author`} value={draft.author ?? ""} onChange={(e) => setMeta("author", e.target.value || undefined)} />
          </Row>
          <Row label="CCLI number" htmlFor={`${idp}-ccli`}>
            <Input id={`${idp}-ccli`} value={draft.ccliNumber ?? ""} onChange={(e) => setMeta("ccliNumber", e.target.value || undefined)} />
          </Row>
          <Row label="Copyright" htmlFor={`${idp}-copyright`}>
            <Input id={`${idp}-copyright`} value={draft.copyright ?? ""} onChange={(e) => setMeta("copyright", e.target.value || undefined)} />
          </Row>

          <h3 style={{ margin: "4px 0 0", fontSize: 12, fontWeight: 600 }}>Custom fields</h3>
          {projectSchema.map((f) => (
            <Row key={f.key} label={f.label} htmlFor={`${idp}-cf-${f.key}`}>
              <Input
                id={`${idp}-cf-${f.key}`}
                type={f.type === "number" ? "number" : "text"}
                value={draft.customFields[f.key] ?? ""}
                onChange={(e) => setCustomField(f.key, e.target.value)}
              />
            </Row>
          ))}
          {adHocKeys.map((k) => (
            <Row key={k} label={k} htmlFor={`${idp}-cf-${k}`}>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <Input
                  id={`${idp}-cf-${k}`}
                  value={draft.customFields[k] ?? ""}
                  onChange={(e) => setCustomField(k, e.target.value)}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <IconButton aria-label={`Remove field ${k}`} title="Remove field" onClick={() => removeCustomField(k)}>
                  <X size={14} aria-hidden />
                </IconButton>
              </div>
            </Row>
          ))}
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <Input
              value={newFieldLabel}
              placeholder="New field label, e.g. Hymn number"
              aria-label="New field label"
              invalid={!!newFieldError}
              onChange={(e) => {
                setNewFieldLabel(e.target.value);
                if (newFieldError) setNewFieldError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomField();
                }
              }}
              style={{ flex: 1, minWidth: 0 }}
            />
            <Button size="sm" onClick={addCustomField} icon={<Plus size={14} />}>
              Add field
            </Button>
          </div>
          {newFieldError && <div style={{ fontSize: 11, color: colors.dangerText }}>{newFieldError}</div>}
        </>
      )}
    </section>
  );
}

function seed(suggestions: Record<string, SuggestedFieldMatch>): { map: Record<string, string>; exacts: Set<string> } {
  const map: Record<string, string> = {};
  const exacts = new Set<string>();
  for (const [k, s] of Object.entries(suggestions)) {
    if (s.kind !== "none") map[k] = s.songFieldKey;
    if (s.kind === "exact") exacts.add(k);
  }
  return { map, exacts };
}
