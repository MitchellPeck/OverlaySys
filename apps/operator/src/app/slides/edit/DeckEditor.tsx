"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { v4 as uuid } from "uuid";
import { resolveSlideTemplateId, type Deck, type TemplateMeta } from "@overlaysys/core";
import {
  Button,
  Dialog,
  IconButton,
  Input,
  Menu,
  SaveBar,
  Select,
  Textarea,
  colors,
  confirm,
  fontSize,
  radius,
  toast,
  type MenuItem,
} from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { getClient } from "@/lib/useWs";
import { useConnection } from "@/lib/useConnection";
import { ackErrorText, requestOne, sendAndAwaitAck } from "@/lib/awaitAck";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { templatesFor } from "@/lib/templateRoles";
import { TemplateThumbnail } from "@/lib/thumbnails/TemplateThumbnail";
import { useTemplateBody } from "@/lib/thumbnails/useTemplateBody";
import { plural } from "@/lib/listFormat";
import { PageChrome } from "@/app/shell/PageChrome";
import { EditorFrame, SlideThumbGrid, slideFieldsFor, type SlideCard } from "@/app/songs/edit/slides";
import { useDeck } from "../useDeck";
import { LicensingField } from "../LicensingField";
import { deckDeleteConfirm, licensingLabel } from "../libraryConfig";
import { DeckSlideFields } from "./DeckSlideFields";
import {
  addSlide,
  appendPastedText,
  deckDefaultOptionLabel,
  deleteSlide,
  duplicateSlide,
  moveSlide,
  parseTags,
  setSlideLabel,
  setSlideTemplate,
} from "./deckDraftOps";

const PREVIEW_WIDTH = 560;
const editHref = (id: string) => `/slides/edit?id=${encodeURIComponent(id)}`;
const same = (a: Deck | null, b: Deck | null) => JSON.stringify(a) === JSON.stringify(b);

function newSlideId(deck: Deck): string {
  const taken = new Set(deck.slides.map((s) => s.id));
  for (;;) {
    const id = `s-${uuid().slice(0, 8)}`;
    if (!taken.has(id)) return id;
  }
}

const labelStyle = { fontSize: fontSize.sm, color: colors.textDim } as const;
const sectionHeading = {
  margin: 0,
  fontSize: fontSize.xs,
  fontWeight: 600,
  color: colors.textDim,
  textTransform: "uppercase",
  letterSpacing: 0.4,
} as const;

/** Template <option>s: suggested lyric designs first, then the rest. Keeps an unknown current id selectable. */
function TemplateOptions({ templates, current }: { templates: TemplateMeta[]; current?: string }) {
  const groups = templatesFor(templates, "lyric");
  const known = !current || templates.some((t) => t.id === current);
  return (
    <>
      {!known && <option value={current}>{current} (missing)</option>}
      {groups.suggested.length > 0 && (
        <optgroup label="Suggested">
          {groups.suggested.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </optgroup>
      )}
      {groups.others.length > 0 && (
        <optgroup label="Other designs">
          {groups.others.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

/**
 * Slide preview that fills the available width up to PREVIEW_WIDTH. The
 * thumbnail renders at the measured inner width so its 16:9 box and text
 * placement match the grid thumbnails instead of being clipped by the frame.
 */
function FittedPreview({ templateId, data }: { templateId: string; data: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(PREVIEW_WIDTH - 2);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cw = el.clientWidth;
      if (cw > 0) setW(cw);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{
        width: "100%",
        maxWidth: PREVIEW_WIDTH,
        boxSizing: "border-box",
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
        overflow: "hidden",
        background: "#000",
      }}
    >
      <TemplateThumbnail templateId={templateId} data={data} width={w} />
    </div>
  );
}

function MissingDeck() {
  const router = useRouter();
  return (
    <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
      <p style={{ margin: 0, color: colors.text, fontSize: 14 }}>This deck doesn&apos;t exist (it may have been deleted)</p>
      <Button variant="secondary" size="md" onClick={() => router.push("/slides")}>
        Back to Slides
      </Button>
    </div>
  );
}

export function DeckEditor({ deckId }: { deckId: string }) {
  const router = useRouter();
  const { connected } = useConnection();
  const templates = useStore((s) => s.templates);
  const templatesLoaded = useStore((s) => s.templatesLoaded);
  const deckMetas = useStore((s) => s.decks);
  const remote = useDeck(deckId || undefined);

  const [saved, setSaved] = useState<Deck | null>(null);
  const [draft, setDraft] = useState<Deck | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const dirty = !!draft && !!saved && !same(draft, saved);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const savingRef = useRef(false);
  /** Set once the deck is gone (deleted here): nothing left to guard. */
  const leavingRef = useRef(false);

  // A different id starts from nothing.
  useEffect(() => {
    setSaved(null);
    setDraft(null);
    setSelectedId(null);
    leavingRef.current = false;
  }, [deckId]);

  useEffect(() => {
    if (connected && !templatesLoaded) getClient().send({ type: "list_templates" });
  }, [connected, templatesLoaded]);

  // Every server copy lands in the store's deck cache (load reply, our own save
  // echo, another client's save). Adopt it unless that would lose unsaved edits;
  // while dirty it only becomes the new baseline (Revert goes back to it).
  useEffect(() => {
    if (!remote || remote.id !== deckId || remote.deletedAt) return;
    setSaved(remote);
    if (!dirtyRef.current) setDraft(remote);
  }, [remote, deckId]);

  const save = useCallback(async (): Promise<boolean> => {
    const d = draftRef.current;
    if (!d || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      await sendAndAwaitAck(getClient(), { type: "save_deck", deck: d }, { op: "save_deck", id: d.id });
      setSaved(d);
      return true;
    } catch (e) {
      toast({ tone: "error", message: `Not saved: ${ackErrorText(e)}` });
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, []);

  useUnsavedGuard(dirty, {
    onSave: save,
    getDirty: () => !leavingRef.current && dirtyRef.current,
    resetKey: deckId,
    canArm: !!draft && draft.id === deckId,
  });

  const update = (fn: (d: Deck) => Deck) => setDraft((d) => (d ? fn(d) : d));

  const slides = draft?.slides ?? [];
  const selIdx = Math.max(0, slides.findIndex((s) => s.id === selectedId));
  const selected = slides[selIdx] ?? null;
  const effectiveId = selected && draft ? resolveSlideTemplateId(selected, {}, draft) : (draft?.defaultTemplateId ?? "");
  const defaultTemplate = useStore((s) => (draft ? s.templateCache[draft.defaultTemplateId] : undefined)) ?? null;

  const cards: SlideCard[] = useMemo(
    () =>
      slides.map((s, i) => ({
        id: s.id,
        templateId: draft ? resolveSlideTemplateId(s, {}, draft) : null,
        data: s.data,
        caption: s.label?.trim() ? `${i + 1} · ${s.label}` : `Slide ${i + 1}`,
        badge: s.templateId ? "Own design" : undefined,
      })),
    [slides, draft],
  );

  if (!deckId || remote === null || remote?.deletedAt) {
    return (
      <>
        <PageChrome title="Deck" />
        <MissingDeck />
      </>
    );
  }

  if (!draft) {
    return (
      <>
        <PageChrome title="Deck" />
        <p style={{ padding: 24, margin: 0, color: colors.textDim }}>
          {connected ? "Loading deck…" : "Not connected to the server."}
        </p>
      </>
    );
  }

  const templateName = (id: string) => templates.find((t) => t.id === id)?.name ?? "missing design";
  const meta = deckMetas.find((m) => m.id === draft.id);

  const slideMenu = (id: string): MenuItem[] => [
    {
      id: "duplicate",
      label: "Duplicate",
      onSelect: () => {
        const nid = newSlideId(draft);
        update((d) => duplicateSlide(d, id, nid));
        setSelectedId(nid);
      },
    },
    { separator: true },
    {
      id: "delete",
      label: "Delete",
      danger: true,
      disabled: draft.slides.length <= 1 ? "A deck needs at least one slide" : false,
      onSelect: () => {
        const i = draft.slides.findIndex((s) => s.id === id);
        const next = draft.slides[i + 1] ?? draft.slides[i - 1];
        update((d) => deleteSlide(d, id));
        if (id === selected?.id && next) setSelectedId(next.id);
      },
    },
  ];

  async function duplicateDeck() {
    try {
      const newId = await requestOne(getClient(), { type: "duplicate_deck", deckId: draft!.id }, (m) =>
        m.type === "ack" && m.op === "duplicate_deck" ? m.id : undefined,
      );
      toast({
        tone: "ok",
        message: dirtyRef.current ? "Deck duplicated (last saved version)" : "Deck duplicated",
        action: { label: "Open", onClick: () => router.push(editHref(newId)) },
      });
    } catch (e) {
      toast({ tone: "error", message: `Not duplicated: ${ackErrorText(e)}` });
    }
  }

  async function deleteDeck() {
    const d = draft!;
    const ask = meta ? deckDeleteConfirm(meta) : null;
    const ok = await confirm(
      ask ?? { title: "Delete deck?", message: `Delete "${d.name}"?`, confirmLabel: "Delete", danger: true },
    );
    if (!ok) return;
    try {
      await sendAndAwaitAck(getClient(), { type: "delete_deck", deckId: d.id }, { op: "delete_deck", id: d.id });
    } catch (e) {
      toast({ tone: "error", message: `Not deleted: ${ackErrorText(e)}` });
      return;
    }
    leavingRef.current = true;
    toast({
      message: "Deck deleted",
      action: {
        label: "Undo",
        onClick: () => {
          sendAndAwaitAck(getClient(), { type: "restore_deck", deckId: d.id }, { op: "restore_deck", id: d.id }).catch(
            (e) => toast({ tone: "error", message: `Not restored: ${ackErrorText(e)}` }),
          );
        },
      },
    });
    router.push("/slides");
  }

  function applyPaste() {
    const d = draftRef.current;
    if (!d) return;
    const key = slideFieldsFor(defaultTemplate)[0]?.key ?? "text";
    const before = new Set(d.slides.map((s) => s.id));
    const next = appendPastedText(d, pasteText, key, () => newSlideId(d));
    if (next === d) return;
    setDraft(next);
    const first = next.slides.find((s) => !before.has(s.id));
    if (first) setSelectedId(first.id);
    setPasteOpen(false);
    setPasteText("");
    toast({ tone: "ok", message: `Added ${plural(next.slides.filter((s) => !before.has(s.id)).length, "slide")}` });
  }

  const deckMenu: MenuItem[] = [
    { id: "paste", label: "Paste text as slides…", onSelect: () => setPasteOpen(true) },
    {
      id: "duplicate-deck",
      label: "Duplicate deck",
      disabled: connected ? false : "Reconnect to duplicate",
      onSelect: () => void duplicateDeck(),
    },
    { separator: true },
    {
      id: "delete-deck",
      label: "Delete deck",
      danger: true,
      disabled: connected ? false : "Reconnect to delete",
      onSelect: () => void deleteDeck(),
    },
  ];

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", fontSize: fontSize.sm }}>
      <Link href="/slides" style={{ color: colors.textDim, textDecoration: "none" }}>
        Slides
      </Link>
      <span style={{ color: colors.textMuted }}>/</span>
      <span style={{ color: colors.text, fontWeight: 600 }}>{draft.name || "(untitled)"}</span>
      <span style={{ color: colors.textMuted, marginLeft: 8 }}>
        {plural(draft.slides.length, "slide")} · {licensingLabel[draft.licensing.kind]}
      </span>
    </div>
  );

  const left = (
    <SlideThumbGrid
      slides={cards}
      selectedId={selected?.id ?? null}
      onSelect={setSelectedId}
      onReorder={(from, to) => update((d) => moveSlide(d, from, to))}
      onAdd={() => {
        const nid = newSlideId(draft);
        update((d) => addSlide(d, selected?.id, nid));
        setSelectedId(nid);
      }}
      addLabel="Add slide"
      menuItems={slideMenu}
      minCardWidth={150}
    />
  );

  const main = selected ? (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <FittedPreview templateId={effectiveId} data={selected.data} />
      <div style={{ maxWidth: PREVIEW_WIDTH }}>
        <SlideFieldsForTemplate
          key={selected.id}
          templateId={effectiveId}
          slideNumber={selIdx + 1}
          data={selected.data}
          onChange={(data) => update((d) => ({ ...d, slides: d.slides.map((s) => (s.id === selected.id ? { ...s, data } : s)) }))}
        />
      </div>
    </div>
  ) : null;

  const right = (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 20 }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={sectionHeading}>Deck</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="deck-name" style={labelStyle}>
            Name
          </label>
          <Input id="deck-name" value={draft.name} onChange={(e) => update((d) => ({ ...d, name: e.target.value }))} />
        </div>
        <TagsField tags={draft.tags} onChange={(tags) => update((d) => ({ ...d, tags }))} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="deck-design" style={labelStyle}>
            Default design
          </label>
          <Select
            id="deck-design"
            value={draft.defaultTemplateId}
            onChange={(e) => update((d) => ({ ...d, defaultTemplateId: e.target.value }))}
          >
            <TemplateOptions templates={templates} current={draft.defaultTemplateId} />
          </Select>
        </div>
        <LicensingField value={draft.licensing} onChange={(licensing) => update((d) => ({ ...d, licensing }))} />
      </section>
      {selected && (
        <section style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: `1px solid ${colors.border}`, paddingTop: 16 }}>
          <h2 style={sectionHeading}>Slide {selIdx + 1}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor="slide-label" style={labelStyle}>
              Label
            </label>
            <Input
              id="slide-label"
              value={selected.label ?? ""}
              placeholder="e.g. Response 1"
              onChange={(e) => update((d) => setSlideLabel(d, selected.id, e.target.value))}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor="slide-design" style={labelStyle}>
              Design
            </label>
            <Select
              id="slide-design"
              value={selected.templateId ?? ""}
              onChange={(e) => update((d) => setSlideTemplate(d, selected.id, e.target.value || undefined))}
            >
              <option value="">{deckDefaultOptionLabel(templateName(draft.defaultTemplateId))}</option>
              <TemplateOptions templates={templates} current={selected.templateId} />
            </Select>
          </div>
        </section>
      )}
    </div>
  );

  return (
    <>
      <PageChrome
        title="Deck"
        docTitle={draft.name ? `${draft.name} · Slides` : "Deck"}
        actions={
          <>
            <SaveBar
              dirty={dirty}
              saving={saving}
              onSave={() => void save()}
              onRevert={() => setDraft(saved)}
              disabledReason={connected ? undefined : "Reconnect to save"}
            />
            <IconButton aria-label={`More actions for ${draft.name}`} onClick={(e) => setMenuAnchor(e.currentTarget)}>
              <MoreHorizontal size={16} />
            </IconButton>
          </>
        }
      />
      {menuAnchor && <Menu items={deckMenu} anchor={menuAnchor} onClose={() => setMenuAnchor(null)} />}
      <EditorFrame header={header} left={left} main={main} right={right} rightWidth="320px" />
      <Dialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title="Paste text as slides"
        size="md"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="md" disabled={!pasteText.trim()} onClick={applyPaste}>
              Add slides
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Textarea
            aria-label="Text to add as slides"
            rows={12}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"Line A\nLine B\n\nResponse 1"}
          />
          <div style={{ fontSize: fontSize.xs, color: colors.textMuted }}>
            A blank line starts a new slide. Slides are added at the end of the deck.
          </div>
        </div>
      </Dialog>
    </>
  );
}

/** DeckSlideFields for the slide's effective design, loading the design's body when needed. */
function SlideFieldsForTemplate(p: {
  templateId: string;
  slideNumber: number;
  data: Record<string, string>;
  onChange(next: Record<string, string>): void;
}) {
  const { template } = useTemplateBody(p.templateId);
  return <DeckSlideFields template={template} data={p.data} onChange={p.onChange} slideNumber={p.slideNumber} />;
}

/** Comma-separated tags; the text stays as typed, the deck gets the parsed list. */
function TagsField({ tags, onChange }: { tags: string[]; onChange(tags: string[]): void }) {
  const [text, setText] = useState(tags.join(", "));
  // Follow outside changes (Revert, a reload) without fighting the user's typing.
  useEffect(() => {
    setText((t) => (parseTags(t).join("\u0000") === tags.join("\u0000") ? t : tags.join(", ")));
  }, [tags]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label htmlFor="deck-tags" style={labelStyle}>
        Tags
      </label>
      <Input
        id="deck-tags"
        value={text}
        placeholder="e.g. liturgy, advent"
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseTags(e.target.value));
        }}
      />
    </div>
  );
}
