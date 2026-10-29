"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { v4 as uuid } from "uuid";
import { GripVertical, Plus, Repeat2, X } from "lucide-react";
import {
  addLocalSlide,
  addRepeat,
  detachSlidesRow,
  moveAt,
  removeAt,
  removeLocalSlide,
  resolveSlideTemplateId,
  resolveSlidesRow,
  slideAirData,
  setDeck,
  setFieldOverride,
  setLocalSlideField,
  setRowTemplate,
  setSubset,
  useAllSlides as allSlides,
  rowSlideIds,
  type Deck,
  type DeckSlide,
  type SlidesRow,
} from "@overlaysys/core";
import { Button, Checkbox, Input, Textarea, colors, fontSize, radius, useConfirm } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { plural } from "@/lib/listFormat";
import { useDeckFor } from "@/lib/slidesRowView";
import { useTemplateBody } from "@/lib/thumbnails/useTemplateBody";
import { TemplateThumbnail } from "@/lib/thumbnails/TemplateThumbnail";
import { slideFieldsFor } from "@/app/songs/edit/slides";
import { FormRow } from "@/app/shows/edit/forms/ItemCommonFields";
import { TemplateSelect } from "@/app/shows/edit/TemplateSelect";
import { DeckPicker } from "./DeckPicker";
import {
  deckDefaultLabel,
  hiddenTextWarning,
  slideTextHidden,
  detachConfirm,
  overrideValue,
  ownDesignCount,
  slideCaption,
  slideCountText,
  slideListEntries,
  unshownValues,
} from "./slidesRowModel";

const newSlideId = () => `s-${uuid().slice(0, 8)}`;

/** Text field keys of a cached template ("text" when it isn't loaded), for seeding "" into new slides. */
export function textFieldKeys(templateId: string | undefined): string[] {
  const t = templateId ? useStore.getState().templateCache[templateId] ?? null : null;
  return slideFieldsFor(t).map((f) => f.key);
}

/**
 * Inspector for a slides row in the show editor: the deck, this week's slides
 * (subset, order, repeats), this week's design and text, and Detach. Every
 * edit goes through `onChange` with the whole row; nothing is saved here.
 */
export function SlidesRowInspector({ row, onChange }: { row: SlidesRow; onChange(row: SlidesRow): void }) {
  const deck = useDeckFor(row);
  const confirm = useConfirm();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  // Edits made from async callbacks (confirm) land on the latest row.
  const rowRef = useRef(row);
  rowRef.current = row;

  // Back to the first slide when another row (or deck) is shown.
  useEffect(() => setSelected(0), [row.id, row.deckId]);

  const oneOff = !row.deckId;
  // One-off rows edit their own slides with the same ops.
  const source: Pick<Deck, "slides"> | null = oneOff ? { slides: row.localSlides ?? [] } : deck ?? null;

  const deckLine = (() => {
    if (oneOff) return <DeckLine name="One-off slides" detail={countDetail(row, source, true)} />;
    if (deck === undefined) return <DeckLine name="Loading deck…" />;
    if (deck === null) return <DeckLine name="Missing deck" detail="Deck deleted or not synced" warn />;
    return <DeckLine name={deck.name} detail={countDetail(row, deck)} />;
  })();

  const switchDeck = async (deckId: string) => {
    const cur = rowRef.current;
    if (deckId === cur.deckId) return;
    if (!cur.deckId && (cur.localSlides ?? []).length > 0) {
      const ok = await confirm({
        title: "Replace these slides?",
        message: "This item's own slides are replaced by the deck's slides.",
        confirmLabel: "Use deck",
      });
      if (!ok) return;
    }
    onChange(setDeck(rowRef.current, deckId));
  };

  const detach = async () => {
    if (!deck) return;
    if (!(await confirm(detachConfirm(deck.name, deck.licensing.kind === "ccli")))) return;
    onChange(detachSlidesRow(rowRef.current, deck, newSlideId));
  };

  return (
    <>
      <FormRow label="Deck">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {deckLine}
          <div style={{ display: "flex", gap: 12 }}>
            <LinkButton onClick={() => setPickerOpen(true)}>{oneOff ? "Use a deck" : "Change deck"}</LinkButton>
            {row.deckId && deck && (
              <Link href={`/slides/edit?id=${encodeURIComponent(row.deckId)}`} style={linkStyle}>
                Edit deck
              </Link>
            )}
          </div>
        </div>
      </FormRow>

      {source && (
        <SlidesList
          row={row}
          source={source}
          oneOff={oneOff}
          selected={selected}
          onSelect={setSelected}
          onChange={onChange}
        />
      )}

      {(oneOff || deck) && source && (
        <DesignRow row={row} deck={deck ?? null} source={source} oneOff={oneOff} onChange={onChange} />
      )}

      {source && (
        <SlideText row={row} source={source} deck={deck ?? null} oneOff={oneOff} position={selected} onChange={onChange} />
      )}

      {row.deckId && deck && (
        <FormRow label="">
          <div>
            <Button variant="secondary" size="sm" onClick={() => void detach()}>
              Detach to this show
            </Button>
          </div>
        </FormRow>
      )}

      <DeckPicker
        open={pickerOpen}
        title={oneOff ? "Use a deck" : "Change deck"}
        onClose={() => setPickerOpen(false)}
        onPick={(deckId) => {
          setPickerOpen(false);
          void switchDeck(deckId);
        }}
      />
    </>
  );
}

/** Deck rows: "n of m slides" (distinct deck slides used). One-off rows: how many slides play. */
function countDetail(row: SlidesRow, source: Pick<Deck, "slides"> | null, oneOff = false): string {
  if (!source) return "";
  const byId = new Set(source.slides.map((s) => s.id));
  const ids = rowSlideIds(row, source).filter((id) => byId.has(id));
  if (oneOff) return plural(ids.length, "slide");
  return slideCountText(new Set(ids).size, source.slides.length);
}

function DeckLine({ name, detail, warn }: { name: string; detail?: string; warn?: boolean }) {
  return (
    <div style={{ fontSize: fontSize.md, color: warn ? colors.warn : colors.text, paddingTop: 4 }}>
      <span style={{ fontWeight: 600 }}>{name}</span>
      {detail && <span style={{ color: colors.textMuted }}> · {detail}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slides for this week: checkbox per deck slide, drag to reorder, Repeat.
// ---------------------------------------------------------------------------

function SlidesList({
  row,
  source,
  oneOff,
  selected,
  onSelect,
  onChange,
}: {
  row: SlidesRow;
  source: Pick<Deck, "slides">;
  oneOff: boolean;
  selected: number;
  onSelect(position: number): void;
  onChange(row: SlidesRow): void;
}) {
  const entries = useMemo(() => slideListEntries(row, source), [row, source]);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const missing = entries.filter((e) => e.kind === "in" && !e.slide).length;
  const inCount = entries.filter((e) => e.kind === "in").length;
  const deckIndex = (id: string) => source.slides.findIndex((s) => s.id === id);

  const include = (slideId: string) => onChange(setSubset(row, source, [...rowSlideIds(row, source), slideId]));

  return (
    <FormRow label="Slides">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: fontSize.xs, color: colors.textMuted }}>
          <span style={{ flex: 1 }}>{oneOff ? "Slides for this show" : "Slides for this week"}</span>
          {row.slideIds && <LinkButton onClick={() => onChange(allSlides(row))}>Use all slides</LinkButton>}
        </div>
        {missing > 0 && (
          <div role="status" style={{ fontSize: fontSize.xs, color: colors.warn }}>
            {missing === 1 ? "1 slide is" : `${missing} slides are`} no longer in the deck and will be skipped.
          </div>
        )}
        <ol
          aria-label="Slides"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.md,
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {entries.map((e, i) => {
            const isIn = e.kind === "in";
            const pos = isIn ? e.position : -1;
            const sel = isIn && pos === selected;
            const caption = slideCaption(e.slide, e.slide ? deckIndex(e.slideId) : 0);
            return (
              <li
                key={isIn ? `in-${pos}` : `out-${e.slideId}`}
                draggable={isIn}
                onDragStart={(ev) => {
                  if (!isIn) return;
                  setDrag(pos);
                  ev.dataTransfer.effectAllowed = "move";
                  ev.dataTransfer.setData("text/plain", String(pos));
                }}
                onDragOver={(ev) => {
                  if (drag === null || !isIn) return;
                  ev.preventDefault();
                  setOver(pos);
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
                onDrop={(ev) => {
                  ev.preventDefault();
                  if (drag !== null && isIn && drag !== pos) {
                    onChange(moveAt(row, source, drag, pos));
                    onSelect(pos);
                  }
                  setDrag(null);
                  setOver(null);
                }}
                onClick={() => isIn && e.slide && onSelect(pos)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 8px",
                  borderTop: i === 0 ? "none" : `1px solid ${colors.border}`,
                  borderTopColor: over === pos && drag !== null && drag !== pos ? colors.accent : undefined,
                  background: sel ? colors.control : "transparent",
                  opacity: isIn ? 1 : 0.6,
                  cursor: isIn && e.slide ? "pointer" : "default",
                  fontSize: fontSize.sm,
                }}
              >
                <span aria-hidden style={{ color: colors.textMuted, display: "flex", cursor: isIn ? "grab" : "default", visibility: isIn ? "visible" : "hidden" }}>
                  <GripVertical size={14} />
                </span>
                {oneOff && isIn && e.slide ? (
                  // One-off slides have no deck to come back from: delete, don't untick.
                  <RowAction
                    label={`Delete ${caption}`}
                    title={source.slides.length <= 1 ? "A slides item keeps at least one slide" : "Delete slide"}
                    disabled={source.slides.length <= 1}
                    onClick={() => {
                      onChange(removeLocalSlide(row, e.slideId));
                      onSelect(0);
                    }}
                  >
                    <X size={13} />
                  </RowAction>
                ) : (
                  <span onClick={(ev) => ev.stopPropagation()}>
                    <Checkbox
                      checked={isIn}
                      aria-label={isIn ? `Leave out ${caption}` : `Include ${caption}`}
                      // Unticking the last slide would leave the row empty.
                      disabled={isIn && inCount <= 1}
                      onChange={() => (isIn ? onChange(removeAt(row, source, pos)) : include(e.slideId))}
                    />
                  </span>
                )}
                <span style={{ width: 22, color: colors.textMuted, fontSize: fontSize.xs, textAlign: "right" }}>
                  {isIn ? `${pos + 1}.` : ""}
                </span>
                <button
                  type="button"
                  // Focusable caption: Enter/Space selects; Alt+↑/↓ moves the slide.
                  disabled={!isIn || !e.slide}
                  aria-current={sel || undefined}
                  title={isIn && e.slide ? "Select · Alt+↑/↓ to move" : undefined}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    if (isIn && e.slide) onSelect(pos);
                  }}
                  onKeyDown={(ev) => {
                    if (!isIn || !ev.altKey || (ev.key !== "ArrowUp" && ev.key !== "ArrowDown")) return;
                    ev.preventDefault();
                    const to = pos + (ev.key === "ArrowUp" ? -1 : 1);
                    if (to < 0 || to >= inCount) return;
                    onChange(moveAt(row, source, pos, to));
                    onSelect(to);
                    // Keep focus on the moved slide's caption after re-render.
                    const list = ev.currentTarget.closest("ol");
                    requestAnimationFrame(() =>
                      (list?.querySelectorAll("li")[to]?.querySelector("button[data-caption]") as HTMLElement | null)?.focus(),
                    );
                  }}
                  data-caption=""
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    padding: 0,
                    font: "inherit",
                    cursor: "inherit",
                    color: e.slide ? colors.text : colors.warn,
                  }}
                >
                  {caption}
                  {isIn && e.repeat && <span style={{ marginLeft: 6, color: colors.textMuted, fontSize: fontSize.xs }}>repeat</span>}
                  {isIn && e.slide && hasOverride(row, e.slideId) && !oneOff && (
                    <span style={{ marginLeft: 6, color: colors.textMuted, fontSize: fontSize.xs }}>edited</span>
                  )}
                </button>
                {isIn && e.slide && (
                  <RowAction label={`Repeat ${caption}`} title="Repeat" onClick={() => onChange(addRepeat(row, source, pos))}>
                    <Repeat2 size={13} /> Repeat
                  </RowAction>
                )}
                {isIn && !e.slide && (
                  <RowAction
                    label="Remove missing slide"
                    // Removing the only entry would leave a row that plays nothing.
                    title={inCount <= 1 ? "Include another slide first, or delete this item" : "Remove"}
                    disabled={inCount <= 1}
                    onClick={() => onChange(removeAt(row, source, pos))}
                  >
                    <X size={13} /> Remove
                  </RowAction>
                )}
              </li>
            );
          })}
        </ol>
        {oneOff && (
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onChange(addLocalSlide(row, newSlideId(), textFieldKeys(row.templateId)));
                onSelect(inCount);
              }}
            >
              <Plus size={13} /> Add slide
            </Button>
          </div>
        )}
      </div>
    </FormRow>
  );
}

const hasOverride = (row: SlidesRow, slideId: string) => !!row.fieldOverrides?.[slideId];

function RowAction({
  label,
  title,
  onClick,
  disabled,
  children,
}: {
  label: string;
  title: string;
  onClick(): void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={(ev) => {
        ev.stopPropagation();
        onClick();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        background: "none",
        border: "none",
        padding: "2px 4px",
        borderRadius: radius.sm,
        color: colors.textDim,
        fontSize: fontSize.xs,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Design for this week.
// ---------------------------------------------------------------------------

function DesignRow({
  row,
  deck,
  source,
  oneOff,
  onChange,
}: {
  row: SlidesRow;
  deck: Deck | null;
  source: Pick<Deck, "slides">;
  oneOff: boolean;
  onChange(row: SlidesRow): void;
}) {
  const metas = useStore((s) => s.templates);
  const templatesLoaded = useStore((s) => s.templatesLoaded);
  const deckDefault = deck ? metas.find((t) => t.id === deck.defaultTemplateId)?.name : undefined;
  const own = ownDesignCount(row, source);
  return (
    <FormRow label={oneOff ? "Design" : "Design for this week"}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <TemplateSelect
          label={oneOff ? "Design" : "Design for this week"}
          use="lyric"
          value={row.templateId ?? ""}
          emptyLabel={oneOff ? undefined : deckDefaultLabel(deckDefault, templatesLoaded)}
          onChange={(id) => onChange(setRowTemplate(row, id || undefined))}
        />
        {own > 0 && (
          <span style={{ fontSize: fontSize.xs, color: colors.textMuted }}>
            {own === 1 ? "1 slide uses its own design" : `${own} slides use their own design`}
          </span>
        )}
        {row.templateId && <LoadTemplate templateId={row.templateId} />}
        <HiddenTextWarning row={row} deck={oneOff ? null : deck} />
      </div>
    </FormRow>
  );
}

/** Fetches a template body into the cache (the row design), so the warning below can count against it. */
function LoadTemplate({ templateId }: { templateId: string }) {
  useTemplateBody(templateId);
  return null;
}

/**
 * "N slides' text isn't shown by this design": any playing slide (with this
 * week's text) storing non-empty text its effective design has no field for.
 * Slides whose design hasn't loaded yet aren't counted.
 */
function HiddenTextWarning({ row, deck }: { row: SlidesRow; deck: Deck | null }) {
  const templateCache = useStore((s) => s.templateCache);
  const n = useMemo(() => {
    const seen = new Set<string>();
    let count = 0;
    for (const s of resolveSlidesRow(row, deck).slides) {
      if (seen.has(s.slideId)) continue;
      seen.add(s.slideId);
      const t = templateCache[s.templateId];
      if (t && slideTextHidden(s.data, slideFieldsFor(t))) count++;
    }
    return count;
  }, [row, deck, templateCache]);
  const text = hiddenTextWarning(n);
  if (!text) return null;
  return (
    <span role="status" style={{ fontSize: fontSize.xs, color: colors.warn }}>
      {text}. Pick another design, or use &quot;Copy into …&quot; on each slide.
    </span>
  );
}

// ---------------------------------------------------------------------------
// Text for this week (selected slide).
// ---------------------------------------------------------------------------

function SlideText({
  row,
  source,
  deck,
  oneOff,
  position,
  onChange,
}: {
  row: SlidesRow;
  source: Pick<Deck, "slides">;
  deck: Deck | null;
  oneOff: boolean;
  position: number;
  onChange(row: SlidesRow): void;
}) {
  const ids = rowSlideIds(row, source);
  const slideId = ids[Math.min(position, ids.length - 1)];
  const slide: DeckSlide | undefined = source.slides.find((s) => s.id === slideId);
  if (!slide) return null;
  const templateId = resolveSlideTemplateId(slide, row, oneOff ? null : deck);
  const p = { row, source, oneOff, position: Math.min(position, ids.length - 1), slide, templateId, onChange };
  return templateId ? <SlideTextWithTemplate {...p} /> : <SlideTextView {...p} template={null} />;
}

type SlideTextProps = {
  row: SlidesRow;
  source: Pick<Deck, "slides">;
  oneOff: boolean;
  position: number;
  slide: DeckSlide;
  templateId: string;
  onChange(row: SlidesRow): void;
};

function SlideTextWithTemplate(p: SlideTextProps) {
  const { template } = useTemplateBody(p.templateId);
  return <SlideTextView {...p} template={template} />;
}

function SlideTextView({
  row,
  source,
  oneOff,
  position,
  slide,
  templateId,
  template,
  onChange,
}: SlideTextProps & { template: Parameters<typeof slideFieldsFor>[0] }) {
  const overrides = oneOff ? {} : row.fieldOverrides?.[slide.id] ?? {};
  const data = { ...slide.data, ...overrides };
  const fields = slideFieldsFor(template);
  const index = source.slides.indexOf(slide);
  const label = oneOff ? "Text" : "Text for this week";

  const set = (key: string, value: string) => {
    // "" is stored, never deleted: a missing key would air the design's sample text.
    if (oneOff) onChange(setLocalSlideField(row, slide.id, key, value));
    else onChange(setFieldOverride(row, slide.id, key, overrideValue(value, slide.data[key])));
  };

  // Text stored under keys this design has no field for (only once the design has loaded).
  const unshownAll = template ? unshownValues(data, fields.map((f) => f.key)) : [];
  const copyTarget = fields.find((f) => f.multiline) ?? fields[0];
  // Once copied, the text is shown; stop warning.
  const copied = !!copyTarget && data[copyTarget.key] === unshownAll.map((u) => u.value).join("\n");
  const unshown = copied ? [] : unshownAll;

  return (
    <FormRow label={label}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          {templateId ? (
            <TemplateThumbnail templateId={templateId} data={slideAirData(data, template)} width={160} label={`Slide ${position + 1} preview`} />
          ) : null}
          <div style={{ fontSize: fontSize.xs, color: colors.textMuted, paddingTop: 2 }}>
            Slide {position + 1}
            {slideCaption(slide, index) !== `Slide ${index + 1}` && ` · ${slideCaption(slide, index)}`}
            {!oneOff && <div style={{ marginTop: 4 }}>Changes here apply to this show only.</div>}
          </div>
        </div>
        {fields.length === 0 && (
          <span style={{ fontSize: fontSize.xs, color: colors.textMuted }}>This design has no text fields.</span>
        )}
        {fields.map((f) => {
          const edited = !oneOff && overrides[f.key] !== undefined;
          const id = `slide-${row.id}-${f.key}`;
          return (
            <div key={f.key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <label htmlFor={id} style={{ fontSize: fontSize.xs, color: colors.textDim }}>
                  {f.label}
                </label>
                {edited && <span style={{ fontSize: fontSize.xs, color: colors.textMuted }}>edited for this week</span>}
                <span style={{ flex: 1 }} />
                {edited && (
                  <LinkButton
                    ariaLabel={`Reset ${f.label}`}
                    onClick={() => onChange(setFieldOverride(row, slide.id, f.key, undefined))}
                  >
                    Reset
                  </LinkButton>
                )}
              </div>
              {f.multiline ? (
                <Textarea
                  id={id}
                  rows={3}
                  value={data[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", resize: "vertical" }}
                />
              ) : (
                <Input id={id} value={data[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} />
              )}
            </div>
          );
        })}
        {unshown.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: 8,
              border: `1px solid ${colors.border}`,
              borderRadius: radius.md,
            }}
          >
            <span role="status" style={{ fontSize: fontSize.xs, color: colors.warn }}>
              This design doesn&apos;t show this slide&apos;s text
            </span>
            {unshown.map((u) => (
              <div key={u.key} style={{ fontSize: fontSize.xs, color: colors.textDim, whiteSpace: "pre-wrap" }}>
                <span style={{ color: colors.textMuted }}>{u.key}: </span>
                {u.value}
              </div>
            ))}
            {copyTarget && (
              <div>
                <LinkButton
                  onClick={() => {
                    const text = unshown.map((u) => u.value).join("\n");
                    if (oneOff) onChange(setLocalSlideField(row, slide.id, copyTarget.key, text));
                    else onChange(setFieldOverride(row, slide.id, copyTarget.key, text));
                  }}
                >
                  Copy into {copyTarget.label}
                </LinkButton>
              </div>
            )}
          </div>
        )}
      </div>
    </FormRow>
  );
}

// ---------------------------------------------------------------------------

const linkStyle: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: colors.accent,
  fontSize: fontSize.sm,
  cursor: "pointer",
  textDecoration: "none",
};

function LinkButton({ onClick, children, ariaLabel }: { onClick(): void; children: ReactNode; ariaLabel?: string }) {
  return (
    <button type="button" aria-label={ariaLabel} onClick={onClick} style={linkStyle}>
      {children}
    </button>
  );
}
