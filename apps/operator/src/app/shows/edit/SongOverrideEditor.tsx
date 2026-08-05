"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type ChannelConfig,
  type ShowSong,
  type Song,
  type SongRow,
  type SuggestedFieldMatch,
  type Template,
  type TemplateMeta,
  listSongFieldDescriptors,
  resolveArrangement,
  resolveCustomFieldValue,
  suggestFieldMap,
} from "@overlaysys/core";
import { Input, Select, colors } from "@overlaysys/ui";
import { FieldMappingTable } from "@/app/songs/edit/FieldMappingTable";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { isCloudMode } from "@/lib/mode";
import { getTemplateCloud } from "@/lib/cloudData";
import { ArrangementModal, arrangementSummary } from "./ArrangementModal";

/**
 * Inline override editor for a single {@link ShowSong} entry. Owns per-editor
 * state (confirmedKeys for the intro/outro maps) and the template-hydration
 * effect; receives the entry + song + handlers from the parent panel. Mirrors
 * the song editor's Defaults section in layout and field-map handling.
 */
export function SongOverrideEditor({
  entry,
  song,
  templates,
  templateCache,
  channels,
  onChange,
}: {
  entry: ShowSong;
  song: Song;
  templates: TemplateMeta[];
  templateCache: Record<string, Template>;
  channels: ChannelConfig[];
  onChange: (patch: Partial<ShowSong>) => void;
}) {
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const setTemplate = useStore((s) => s.setTemplate);
  const conn = useStore((s) => s.conn);
  const { send } = useWs();
  const cloud = isCloudMode();
  const [introConfirmed, setIntroConfirmed] = useState<Set<string>>(() => new Set());
  const [outroConfirmed, setOutroConfirmed] = useState<Set<string>>(() => new Set());
  const [arrModalOpen, setArrModalOpen] = useState(false);

  // Memoize so projectSchema is stable across renders that don't change the
  // project schema; otherwise the downstream `useMemo`s that depend on it
  // would invalidate every render (a fresh `[]` is a new reference).
  const projectSchema = useMemo(
    () => projects.find((p) => p.id === currentProjectId)?.songCustomFieldSchema ?? [],
    [projects, currentProjectId],
  );
  const songFieldDescriptors = useMemo(
    () => listSongFieldDescriptors(song, projectSchema),
    [song, projectSchema],
  );

  // `resolveCustomFieldValue` runs the canonical Row → ShowSong → Song cascade.
  // The override editor lives outside any specific row context, so we pass a
  // dummy empty SongRow — the helper's row parameter is currently reserved for
  // a future row-level override layer and is intentionally unused. Casting via
  // `unknown` keeps the placeholder explicit at the call site.
  const dummyRow = useMemo(() => ({}) as unknown as SongRow, []);
  function getCustomFieldValue(key: string): string | undefined {
    return resolveCustomFieldValue(key, dummyRow, entry, song);
  }

  // Effective template ids for the FieldMappingTable: explicit override wins,
  // else song default. We render the map against whichever is effective so the
  // operator always sees what's about to be sent.
  const effectiveIntroTplId = entry.introTemplateId ?? song.defaultIntroTemplateId;
  const effectiveOutroTplId = entry.outroTemplateId ?? song.defaultOutroTemplateId;

  // Hydrate the template bodies we need. Mirrors the song editor's pattern —
  // templateCache is read fresh via getState so a cache pop doesn't refire.
  useEffect(() => {
    const needed: string[] = [];
    if (effectiveIntroTplId) needed.push(effectiveIntroTplId);
    if (effectiveOutroTplId) needed.push(effectiveOutroTplId);
    if (needed.length === 0) return;
    const cacheNow = useStore.getState().templateCache;
    for (const tplId of needed) {
      if (cacheNow[tplId]) continue;
      if (cloud) {
        getTemplateCloud(tplId)
          .then((t) => {
            if (t) setTemplate(t);
          })
          .catch((err) =>
            console.warn(`[shows/edit] template ${tplId} load failed`, err),
          );
      } else if (conn === "open") {
        send({ type: "get_template", templateId: tplId });
      }
    }
  }, [effectiveIntroTplId, effectiveOutroTplId, cloud, conn, send, setTemplate]);

  const introTemplate = effectiveIntroTplId
    ? templateCache[effectiveIntroTplId]
    : undefined;
  const outroTemplate = effectiveOutroTplId
    ? templateCache[effectiveOutroTplId]
    : undefined;
  const introSuggestions: Record<string, SuggestedFieldMatch> = useMemo(
    () => (introTemplate ? suggestFieldMap(introTemplate.fields, songFieldDescriptors) : {}),
    [introTemplate, songFieldDescriptors],
  );
  const outroSuggestions: Record<string, SuggestedFieldMatch> = useMemo(
    () => (outroTemplate ? suggestFieldMap(outroTemplate.fields, songFieldDescriptors) : {}),
    [outroTemplate, songFieldDescriptors],
  );

  // Field maps + literals for the table: when an override exists use it
  // (possibly empty = "all fields cleared"); otherwise show the song default so
  // operators see what's effective without having to toggle override.
  const effectiveIntroMap =
    entry.introTemplateId !== undefined
      ? entry.introFieldMap ?? {}
      : song.defaultIntroFieldMap ?? {};
  const effectiveOutroMap =
    entry.outroTemplateId !== undefined
      ? entry.outroFieldMap ?? {}
      : song.defaultOutroFieldMap ?? {};
  const effectiveIntroLiterals =
    entry.introTemplateId !== undefined
      ? entry.introFieldLiterals ?? {}
      : song.defaultIntroFieldLiterals ?? {};
  const effectiveOutroLiterals =
    entry.outroTemplateId !== undefined
      ? entry.outroFieldLiterals ?? {}
      : song.defaultOutroFieldLiterals ?? {};

  function overrideTemplate(which: "intro" | "outro", templateId: string | undefined) {
    const songDefault =
      which === "intro" ? song.defaultIntroTemplateId : song.defaultOutroTemplateId;
    // Reverting to song default clears the template, field map, AND literals.
    if (templateId === undefined) {
      onChange(
        which === "intro"
          ? { introTemplateId: undefined, introFieldMap: undefined, introFieldLiterals: undefined }
          : { outroTemplateId: undefined, outroFieldMap: undefined, outroFieldLiterals: undefined },
      );
      if (which === "intro") setIntroConfirmed(new Set());
      else setOutroConfirmed(new Set());
      return;
    }
    const tpl = templateCache[templateId];
    const suggestions = tpl ? suggestFieldMap(tpl.fields, songFieldDescriptors) : {};
    // If overriding to the same template the song already defaults to,
    // start from the song's curated map instead of re-deriving from
    // suggestions — preserves the user's prior work.
    const seedMap =
      templateId === songDefault
        ? which === "intro"
          ? song.defaultIntroFieldMap ?? {}
          : song.defaultOutroFieldMap ?? {}
        : Object.fromEntries(
            Object.entries(suggestions)
              .filter(([, s]) => s.kind !== "none")
              .map(([k, s]) => [k, (s as { songFieldKey: string }).songFieldKey]),
          );
    const persistMap = Object.keys(seedMap).length > 0 ? seedMap : undefined;
    onChange(
      which === "intro"
        ? { introTemplateId: templateId, introFieldMap: persistMap }
        : { outroTemplateId: templateId, outroFieldMap: persistMap },
    );
    const exacts = new Set<string>();
    for (const [k, s] of Object.entries(suggestions)) {
      if (s.kind === "exact") exacts.add(k);
    }
    if (which === "intro") setIntroConfirmed(exacts);
    else setOutroConfirmed(exacts);
  }

  function setIntroMap(next: Record<string, string>) {
    onChange({
      introFieldMap: Object.keys(next).length === 0 ? undefined : next,
    });
  }
  function setOutroMap(next: Record<string, string>) {
    onChange({
      outroFieldMap: Object.keys(next).length === 0 ? undefined : next,
    });
  }
  function setIntroLiterals(next: Record<string, string>) {
    onChange({
      introFieldLiterals: Object.keys(next).length === 0 ? undefined : next,
    });
  }
  function setOutroLiterals(next: Record<string, string>) {
    onChange({
      outroFieldLiterals: Object.keys(next).length === 0 ? undefined : next,
    });
  }

  const customFieldKeys = useMemo(() => {
    // Project schema controls order; song-only ad-hoc keys come after, sorted.
    const schemaKeys = new Set(projectSchema.map((f) => f.key));
    const adHoc = Object.keys(song.customFields)
      .filter((k) => !schemaKeys.has(k))
      .sort();
    return [...projectSchema.map((f) => f.key), ...adHoc];
  }, [projectSchema, song.customFields]);

  function setCustomFieldOverride(key: string, value: string | undefined) {
    const next = { ...(entry.customFieldOverrides ?? {}) };
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange({
      customFieldOverrides: Object.keys(next).length === 0 ? undefined : next,
    });
  }

  return (
    <div
      style={{
        padding: "12px",
        borderTop: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <OverrideRow
        label="Channel"
        isOverridden={entry.channelOverride !== undefined}
        defaultText={
          song.defaultChannel
            ? channels.find((c) => c.id === song.defaultChannel)?.name ??
              song.defaultChannel
            : "(none — inherits)"
        }
        onRevert={() => onChange({ channelOverride: undefined })}
        onOverride={() => {
          // Need *some* channel id to seed the override with; "" is not a
          // meaningful value and would persist as an empty-string override.
          // If neither the song default nor the channel list yields one,
          // bail out and leave the inherited state in place.
          const seed = song.defaultChannel ?? channels[0]?.id;
          if (!seed) return;
          onChange({ channelOverride: seed });
        }}
      >
        <Select
          value={entry.channelOverride ?? ""}
          onChange={(e) =>
            onChange({ channelOverride: e.target.value || undefined })
          }
        >
          <option value="">(none)</option>
          {entry.channelOverride &&
            !channels.some((c) => c.id === entry.channelOverride) && (
              <option value={entry.channelOverride}>
                {entry.channelOverride} (missing)
              </option>
            )}
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </OverrideRow>

      <OverrideRow
        label="Lyric template"
        isOverridden={entry.lyricTemplateId !== undefined}
        defaultText={
          song.defaultLyricTemplateId
            ? templates.find((t) => t.id === song.defaultLyricTemplateId)?.name ??
              song.defaultLyricTemplateId
            : "(none)"
        }
        onRevert={() => onChange({ lyricTemplateId: undefined })}
        onOverride={() =>
          onChange({
            lyricTemplateId: song.defaultLyricTemplateId ?? templates[0]?.id ?? "",
          })
        }
      >
        <TemplateSelect
          value={entry.lyricTemplateId}
          templates={templates}
          onChange={(v) => onChange({ lyricTemplateId: v })}
        />
      </OverrideRow>

      <OverrideRow
        label="Intro template"
        isOverridden={entry.introTemplateId !== undefined}
        defaultText={
          song.defaultIntroTemplateId
            ? templates.find((t) => t.id === song.defaultIntroTemplateId)?.name ??
              song.defaultIntroTemplateId
            : "(none — skip)"
        }
        onRevert={() => overrideTemplate("intro", undefined)}
        onOverride={() =>
          overrideTemplate(
            "intro",
            song.defaultIntroTemplateId ?? templates[0]?.id ?? "",
          )
        }
      >
        <TemplateSelect
          value={entry.introTemplateId}
          templates={templates}
          onChange={(v) => overrideTemplate("intro", v)}
          allowEmpty
        />
      </OverrideRow>
      {introTemplate && introTemplate.fields.length > 0 && (
        <div style={{ marginLeft: 108 }}>
          <FieldMappingTable
            templateFields={introTemplate.fields}
            songFields={songFieldDescriptors}
            value={effectiveIntroMap}
            literals={effectiveIntroLiterals}
            suggestions={introSuggestions}
            confirmedKeys={introConfirmed}
            onChange={setIntroMap}
            onLiteralsChange={setIntroLiterals}
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

      <OverrideRow
        label="Outro template"
        isOverridden={entry.outroTemplateId !== undefined}
        defaultText={
          song.defaultOutroTemplateId
            ? templates.find((t) => t.id === song.defaultOutroTemplateId)?.name ??
              song.defaultOutroTemplateId
            : "(none — skip)"
        }
        onRevert={() => overrideTemplate("outro", undefined)}
        onOverride={() =>
          overrideTemplate(
            "outro",
            song.defaultOutroTemplateId ?? templates[0]?.id ?? "",
          )
        }
      >
        <TemplateSelect
          value={entry.outroTemplateId}
          templates={templates}
          onChange={(v) => overrideTemplate("outro", v)}
          allowEmpty
        />
      </OverrideRow>
      {outroTemplate && outroTemplate.fields.length > 0 && (
        <div style={{ marginLeft: 108 }}>
          <FieldMappingTable
            templateFields={outroTemplate.fields}
            songFields={songFieldDescriptors}
            value={effectiveOutroMap}
            literals={effectiveOutroLiterals}
            suggestions={outroSuggestions}
            confirmedKeys={outroConfirmed}
            onChange={setOutroMap}
            onLiteralsChange={setOutroLiterals}
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

      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
        <span style={{ color: colors.textDim, width: 100, flexShrink: 0 }}>Arrangement</span>
        <span style={{ color: colors.text, flex: 1 }}>
          {arrangementSummary(resolveArrangement(dummyRow, entry, song), song)}
        </span>
        <button type="button" onClick={() => setArrModalOpen(true)} style={linkBtn}>
          Arrangement…
        </button>
      </div>
      {arrModalOpen && (
        <ArrangementModal
          song={song}
          level="show"
          value={entry.arrangement}
          inherited={song.defaultArrangement}
          onSave={(next) => onChange({ arrangement: next })}
          onClose={() => setArrModalOpen(false)}
        />
      )}

      {customFieldKeys.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 4 }}>
            Custom field overrides
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {customFieldKeys.map((key) => {
              const override = entry.customFieldOverrides?.[key];
              const isOverridden = override !== undefined;
              // Route both display + the Override-link seed through the same
              // cascade helper so a future row-layer override change shows up
              // here without per-call-site edits.
              const resolvedValue = getCustomFieldValue(key) ?? "";
              const songValue = song.customFields[key] ?? "";
              const projectField = projectSchema.find((f) => f.key === key);
              const label = projectField?.label ?? key;
              return (
                <div
                  key={key}
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <span
                    style={{
                      width: 102,
                      flexShrink: 0,
                      fontSize: 11,
                      color: colors.textDim,
                    }}
                    title={key}
                  >
                    {label}
                  </span>
                  <Input
                    value={isOverridden ? override : resolvedValue}
                    placeholder={isOverridden ? "" : resolvedValue || "(empty)"}
                    onChange={(e) => setCustomFieldOverride(key, e.target.value)}
                    style={{
                      flex: 1,
                      color: isOverridden ? colors.text : colors.textDim,
                    }}
                    type={projectField?.type === "number" ? "number" : "text"}
                    title="Editing this field creates a per-show override. Use 'Use song default' to revert."
                  />
                  {isOverridden ? (
                    <button
                      type="button"
                      onClick={() => setCustomFieldOverride(key, undefined)}
                      style={linkBtn}
                    >
                      Use song default
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCustomFieldOverride(key, songValue)}
                      style={linkBtn}
                    >
                      Override
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Row wrapper for an override control. Renders the label, the inherited
 * placeholder (when not overridden), the child editor (when overridden), and
 * an Override / Use song default link on the right.
 */
function OverrideRow({
  label,
  isOverridden,
  defaultText,
  onRevert,
  onOverride,
  children,
}: {
  label: string;
  isOverridden: boolean;
  defaultText: string;
  onRevert: () => void;
  onOverride: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          width: 100,
          flexShrink: 0,
          fontSize: 12,
          color: colors.textDim,
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {isOverridden ? (
          children
        ) : (
          <span
            style={{
              display: "inline-block",
              padding: "4px 8px",
              border: `1px dashed ${colors.border}`,
              borderRadius: 4,
              color: colors.textDim,
              fontSize: 12,
              fontStyle: "italic",
            }}
            title="Inherited from song default"
          >
            {defaultText}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={isOverridden ? onRevert : onOverride}
        style={linkBtn}
      >
        {isOverridden ? "Use song default" : "Override"}
      </button>
    </div>
  );
}

function TemplateSelect({
  value,
  templates,
  onChange,
  allowEmpty,
}: {
  value: string | undefined;
  templates: TemplateMeta[];
  onChange: (v: string | undefined) => void;
  allowEmpty?: boolean;
}) {
  const current = value ?? "";
  const known = current && templates.some((t) => t.id === current);
  return (
    <Select
      value={current}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      {allowEmpty && <option value="">(none — skip)</option>}
      {!known && current && (
        <option value={current}>{current} (missing)</option>
      )}
      {templates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </Select>
  );
}

const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: colors.accent,
  cursor: "pointer",
  fontSize: 11,
  padding: 0,
  textDecoration: "underline",
};
