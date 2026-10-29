"use client";

import type {
  Field as TemplateField,
  ItemPreview,
  PcoPlanItem,
  DeckMeta,
  DeckSuggestion,
  Template,
  TemplateMeta,
} from "@overlaysys/core";
import { Button, Checkbox, Field, Input, Pill, Select, Stack, colors } from "@overlaysys/ui";
import { ScriptureRefError, parseReference, type TranslationMeta } from "@overlaysys/scripture";
import { FieldInput } from "@/lib/FieldInput";
import { templatesFor, type TemplateUse } from "@/lib/templateRoles";
import { ImportAsSlides } from "./ImportAsSlides";
import { humaniseItemType, importOptions, type ImportAs } from "./importOptions";

export type SongAction = "link" | "create";
export type RowKind = "song" | "item" | "scripture" | "slides";

export interface ItemCfg {
  include: boolean;
  kind: RowKind;
  songAction: SongAction;
  songId?: string;
  lyricTemplateId: string;
  graphicTemplateId: string;
  /** Scripture kind: reference text (pre-filled by guessing from the title). */
  reference: string;
  /** Scripture kind: "" means "use the page default translation". */
  translation: string;
  /** Scripture kind: "" means "use the default scripture template". */
  scriptureTemplateId: string;
  // [P3.19] Slides kind: the chosen deck and the "Remember" checkbox.
  slidesDeckId?: string;
  slidesRemember?: boolean;
  // [/P3.19]
  data: Record<string, string>;
  /** Field keys the operator typed into — preserved across template changes. */
  edited: Set<string>;
}

/** What the "Import as" select shows for a row. */
export function importAsOf(cfg: ItemCfg): ImportAs {
  if (!cfg.include) return "skip";
  if (cfg.kind === "slides") return "slides"; // [P3.19]
  return cfg.kind === "song" ? "song" : "graphic";
}

/** Inline parse error for a scripture reference, or null when it parses. */
export function referenceError(reference: string): string | null {
  if (!reference.trim()) return "Enter a reference";
  try {
    parseReference(reference);
    return null;
  } catch (e) {
    return e instanceof ScriptureRefError ? e.hint ?? e.message : "Invalid reference";
  }
}

const mutedNote = { color: colors.textDim, fontSize: 12, margin: 0 } as const;

function TemplateSelect({
  use,
  value,
  templates,
  onChange,
  defaultLabel,
  ariaLabel,
}: {
  use: TemplateUse;
  value: string;
  templates: TemplateMeta[];
  onChange: (id: string) => void;
  /** When set, adds a leading "" option (e.g. "Default (Scripture settings)"). */
  defaultLabel?: string;
  ariaLabel: string;
}) {
  const { suggested, others } = templatesFor(templates, use);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
      {defaultLabel && <option value="">{defaultLabel}</option>}
      {suggested.length > 0 && (
        <optgroup label="Suggested">
          {suggested.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label="Other">
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

export function PcoItemRow({
  item,
  preview,
  importedIn,
  cfg,
  templates,
  template,
  translations,
  scriptureTranslation,
  onToggleInclude,
  onImportAs,
  onScriptureToggle,
  onReference,
  onScriptureTranslation,
  onScriptureTemplate,
  onSongAction,
  onLyricTemplate,
  onGraphicTemplate,
  onFieldChange,
  decks,
  slidesSuggestion,
  onSlidesDeck,
  onSlidesRemember,
  onSlidesForget,
}: {
  item: PcoPlanItem;
  preview: ItemPreview | undefined;
  importedIn: { showId: string; showName: string }[] | undefined;
  cfg: ItemCfg;
  templates: TemplateMeta[];
  template: Template | null;
  translations: TranslationMeta[];
  scriptureTranslation: string;
  onToggleInclude: () => void;
  onImportAs: (v: ImportAs) => void;
  /** Flip a graphic row between a plain graphic and a scripture reading. */
  onScriptureToggle: () => void;
  onReference: (r: string) => void;
  onScriptureTranslation: (id: string) => void;
  onScriptureTemplate: (id: string) => void;
  onSongAction: (a: SongAction) => void;
  onLyricTemplate: (id: string) => void;
  onGraphicTemplate: (id: string) => void;
  onFieldChange: (key: string, value: string) => void;
  // [P3.19]
  decks: DeckMeta[];
  slidesSuggestion: DeckSuggestion | undefined;
  onSlidesDeck: (id: string) => void;
  onSlidesRemember: (v: boolean) => void;
  onSlidesForget: () => void;
  // [/P3.19]
}) {
  const hasMatch = !!preview?.match;
  const importAs = importAsOf(cfg);
  const options = importOptions(item);
  const refErr = referenceError(cfg.reference);

  // One switch per kind keeps the template picker and the extra controls
  // additive when new import kinds are added.
  let templatePicker: React.ReactNode = null;
  let extras: React.ReactNode = null;
  switch (importAs) {
    case "song":
      templatePicker = (
        <TemplateSelect
          use="lyric"
          value={cfg.lyricTemplateId}
          templates={templates}
          onChange={onLyricTemplate}
          ariaLabel={`Template for ${item.title}`}
        />
      );
      extras = (
        <>
          <Field label="Song">
            <Select
              value={cfg.songAction}
              onChange={(e) => onSongAction(e.target.value as SongAction)}
            >
              {hasMatch && <option value="link">Link to “{preview!.match!.title}”</option>}
              <option value="create">Create new song</option>
            </Select>
          </Field>
          {cfg.songAction === "create" && preview?.hasLyrics === false && (
            <p style={mutedNote}>No lyrics in arrangement — an empty stub will be created.</p>
          )}
          {/* Only the create branch writes song content; linking leaves the
              library song untouched, so the promise would be false there. */}
          {cfg.songAction === "create" && preview?.lyricsFromArrangement && (
            <p style={mutedNote}>
              Lyrics will come from the “{preview.lyricsFromArrangement}” arrangement — this
              item’s own arrangement has none.
            </p>
          )}
        </>
      );
      break;
    case "graphic":
      if (cfg.kind === "scripture") {
        templatePicker = (
          <TemplateSelect
            use="scripture"
            value={cfg.scriptureTemplateId}
            templates={templates}
            onChange={onScriptureTemplate}
            defaultLabel="Default (Scripture settings)"
            ariaLabel={`Template for ${item.title}`}
          />
        );
        extras = (
          <>
            <Field label="Reference" error={refErr ?? undefined}>
              <Input
                value={cfg.reference}
                onChange={(e) => onReference(e.target.value)}
                placeholder="John 3:16-18"
                invalid={!!refErr}
              />
            </Field>
            <Field label="Translation">
              <Select
                value={scriptureTranslation}
                onChange={(e) => onScriptureTranslation(e.target.value)}
              >
                {translations.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.abbreviation} — {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <Button size="sm" onClick={onScriptureToggle}>
                Not scripture
              </Button>
            </div>
          </>
        );
      } else {
        templatePicker = (
          <TemplateSelect
            use="graphic"
            value={cfg.graphicTemplateId}
            templates={templates}
            onChange={onGraphicTemplate}
            ariaLabel={`Template for ${item.title}`}
          />
        );
        extras = (
          <>
            <GraphicFields template={template} data={cfg.data} onChange={onFieldChange} />
            {item.itemType !== "song" && (
              <div>
                <Button size="sm" onClick={onScriptureToggle}>
                  Import as scripture
                </Button>
              </div>
            )}
          </>
        );
      }
      break;
    // [P3.19]
    case "slides":
      extras = (
        <ImportAsSlides
          item={item}
          decks={decks}
          deckId={cfg.slidesDeckId ?? ""}
          remember={cfg.slidesRemember ?? true}
          suggestion={slidesSuggestion}
          onDeck={onSlidesDeck}
          onRemember={onSlidesRemember}
          onForget={onSlidesForget}
        />
      );
      break;
    // [/P3.19]
    case "skip":
      break;
  }

  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: "8px 12px",
        background: colors.surface,
        opacity: cfg.include ? 1 : 0.6,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr) 130px 200px",
          gap: 10,
          alignItems: "center",
        }}
      >
        <Checkbox
          checked={cfg.include}
          onChange={onToggleInclude}
          aria-label={`Include ${item.title}`}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <strong
            style={{
              color: colors.text,
              fontSize: 13,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.title}
          </strong>
          <Pill tone={item.itemType === "song" ? "accent" : "dim"}>
            {humaniseItemType(item.itemType)}
          </Pill>
          {!!importedIn?.length && (
            <Pill tone="good" title={`Already in: ${importedIn.map((s) => s.showName).join(", ")}`}>
              Already imported
            </Pill>
          )}
        </div>
        <Select
          value={importAs}
          onChange={(e) => onImportAs(e.target.value as ImportAs)}
          aria-label={`Import ${item.title} as`}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <div>{templatePicker}</div>
      </div>
      {extras && (
        <div style={{ marginTop: 10, paddingLeft: 28, maxWidth: 560 }}>
          <Stack gap={2}>{extras}</Stack>
        </div>
      )}
    </div>
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
  if (!template) return <p style={mutedNote}>Loading template…</p>;
  if (template.fields.length === 0) return <p style={mutedNote}>Template declares no fields.</p>;
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
