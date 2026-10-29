"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { Section, SectionKind, Song } from "@overlaysys/core";
import { IconButton, Input, Select, colors, useToast, type MenuItem } from "@overlaysys/ui";
import { LYRIC_SLIDE_BUDGET } from "@/lib/slideBreaks";
import { ArrangementChips } from "./ArrangementChips";
import { SECTION_KIND_NAMES, SectionsList } from "./SectionsList";
import { SongDetails } from "./SongDetails";
import { EditorFrame, SlideTextEditor, SlideThumbGrid, sectionKindColor, type SlideCard } from "./slides";
import {
  linesFromText,
  nextSlideId,
  removeSection,
  removeSlide,
  restoreSection,
  restoreSlide,
  setSectionKind,
  slideText,
  uniqueLabel,
} from "./songDraftOps";
import { moveSlideWithin, slideEditorText, songSubtitle } from "./songEditorModel";

const LYRIC_FIELDS = [{ key: "text", label: "Lyrics", multiline: true }];

/**
 * Controlled editor for a single {@link Song} draft: arrangement, sections and
 * their slides, and the Details group (templates, output, credits, custom
 * fields). The song page passes `layout="frame"` (left rail + main); the
 * Planning Center import keeps the default single-column `"stacked"` layout.
 * The page owns loading and saving; this component owns nothing but the draft.
 */
export function SongDraftEditor({
  draft,
  onChange,
  layout = "stacked",
}: {
  draft: Song;
  onChange: Dispatch<SetStateAction<Song>>;
  layout?: "frame" | "stacked";
}) {
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(draft.sections[0]?.id ?? null);
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const section =
    draft.sections.find((s) => s.id === selectedSectionId) ?? draft.sections[0] ?? null;
  const slide = section ? (section.slides.find((sl) => sl.id === selectedSlideId) ?? section.slides[0] ?? null) : null;

  // Keep the selection on something that exists (a paste, revert or undo can
  // replace the sections underneath it).
  useEffect(() => {
    if (section && section.id !== selectedSectionId) setSelectedSectionId(section.id);
  }, [section, selectedSectionId]);

  function selectSection(id: string) {
    setSelectedSectionId(id);
    setSelectedSlideId(null);
  }

  const left = (
    <>
      <ArrangementChips song={draft} onChange={onChange} />
      <SectionsList song={draft} selectedId={section?.id ?? null} onSelect={selectSection} onChange={onChange} />
      <div style={{ borderTop: `1px solid ${colors.border}` }}>
        <SongDetails draft={draft} onChange={onChange} defaultOpen={layout === "stacked"} />
      </div>
    </>
  );

  const main = section ? (
    <SectionEditor
      key={section.id}
      song={draft}
      section={section}
      slideId={slide?.id ?? null}
      onSelectSlide={setSelectedSlideId}
      onSelectSection={selectSection}
      onChange={onChange}
    />
  ) : (
    <p style={{ padding: 12, fontSize: 12, color: colors.textMuted }}>No sections yet. Add one with “+ Section” or paste lyrics.</p>
  );

  const header = (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "8px 12px", minWidth: 0 }}>
      <Input
        value={draft.title}
        onChange={(e) => onChange((d) => ({ ...d, title: e.target.value }))}
        aria-label="Song title"
        placeholder="Untitled song"
        style={{ fontSize: 15, fontWeight: 600, flex: "1 1 auto", minWidth: 0, maxWidth: 480 }}
      />
      <span style={{ fontSize: 12, color: colors.textMuted, whiteSpace: "nowrap" }}>{songSubtitle(draft)}</span>
    </div>
  );

  if (layout === "frame") return <EditorFrame header={header} left={left} main={main} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, border: `1px solid ${colors.border}`, borderRadius: 6 }}>
      <div style={{ borderBottom: `1px solid ${colors.border}` }}>{header}</div>
      <ArrangementChips song={draft} onChange={onChange} />
      <SectionsList song={draft} selectedId={section?.id ?? null} onSelect={selectSection} onChange={onChange} />
      <div style={{ borderTop: `1px solid ${colors.border}` }}>{main}</div>
      <div style={{ borderTop: `1px solid ${colors.border}` }}>
        <SongDetails draft={draft} onChange={onChange} />
      </div>
    </div>
  );
}

/** Main pane: the selected section's header, its slide thumbnails and the selected slide's text. */
function SectionEditor({
  song,
  section,
  slideId,
  onSelectSlide,
  onSelectSection,
  onChange,
}: {
  song: Song;
  section: Section;
  slideId: string | null;
  onSelectSlide(id: string): void;
  onSelectSection(id: string): void;
  onChange: Dispatch<SetStateAction<Song>>;
}) {
  const toast = useToast();
  const [label, setLabel] = useState(section.label);
  const [localText, setLocalText] = useState<{ slideId: string; text: string } | null>(null);
  useEffect(() => setLabel(section.label), [section.label]);

  const lastSection = song.sections.length <= 1;
  const singleSlide = section.slides.length <= 1;
  const slideIdx = Math.max(0, section.slides.findIndex((s) => s.id === slideId));
  const slide = section.slides[slideIdx] ?? null;
  const color = sectionKindColor[section.kind];

  function commitLabel() {
    const want = label.trim() || SECTION_KIND_NAMES[section.kind];
    onChange((d) => ({
      ...d,
      sections: d.sections.map((s) => (s.id === section.id ? { ...s, label: uniqueLabel(d, want, section.id) } : s)),
    }));
  }

  function deleteSection() {
    if (lastSection) return;
    const r = removeSection(song, section.id);
    const idx = song.sections.findIndex((s) => s.id === section.id);
    const neighbour = song.sections[idx + 1] ?? song.sections[idx - 1];
    onChange((d) => removeSection(d, section.id).song);
    if (neighbour) onSelectSection(neighbour.id);
    toast({
      message: `Deleted “${section.label}”`,
      action: {
        label: "Undo",
        onClick: () => {
          onChange((d) => restoreSection(d, r.removed));
          onSelectSection(section.id);
        },
      },
    });
  }

  function deleteSlide(id: string) {
    const r = removeSlide(song, section.id, id);
    if (!r.removed) return;
    const removed = r.removed;
    onChange((d) => removeSlide(d, section.id, id).song);
    toast({
      message: `Deleted slide ${removed.index + 1} of “${section.label}”`,
      action: { label: "Undo", onClick: () => onChange((d) => restoreSlide(d, removed)) },
    });
  }

  function addSlide() {
    const id = nextSlideId(song, section);
    onChange((d) => ({
      ...d,
      sections: d.sections.map((s) => (s.id === section.id ? { ...s, slides: [...s.slides, { id, lines: [""] }] } : s)),
    }));
    onSelectSlide(id);
  }

  function setSlideText(text: string) {
    if (!slide) return;
    setLocalText({ slideId: slide.id, text });
    const lines = linesFromText(text);
    onChange((d) => ({
      ...d,
      sections: d.sections.map((s) =>
        s.id === section.id ? { ...s, slides: s.slides.map((sl) => (sl.id === slide.id ? { ...sl, lines } : sl)) } : s,
      ),
    }));
  }

  const cards: SlideCard[] = section.slides.map((sl, i) => ({
    id: sl.id,
    templateId: song.defaultLyricTemplateId ?? null,
    data: { text: slideText(sl) },
    caption: `Slide ${i + 1}`,
    group: i === 0 ? { label: section.label, color } : null,
  }));

  const menuItems = (id: string): MenuItem[] => [
    {
      id: "delete",
      label: "Delete slide",
      danger: true,
      disabled: singleSlide ? "A section must keep at least one slide" : false,
      onSelect: () => deleteSlide(id),
    },
  ];

  const text = slide ? slideEditorText(localText?.slideId === slide.id ? localText.text : null, slide.lines) : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${colors.border}` }}>
        <span aria-hidden style={{ width: 3, height: 24, borderRadius: 2, background: color, flexShrink: 0 }} />
        <h2 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", margin: 0 }}>
          {section.label}
        </h2>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          aria-label="Section label"
          title={`Section id: ${section.id}`}
          style={{ fontWeight: 600, flex: "1 1 auto", minWidth: 0, maxWidth: 320 }}
        />
        <Select
          aria-label="Section kind"
          value={section.kind}
          onChange={(e) => onChange((d) => setSectionKind(d, section.id, e.target.value as SectionKind))}
          style={{ width: "auto" }}
        >
          {(Object.keys(SECTION_KIND_NAMES) as SectionKind[]).map((k) => (
            <option key={k} value={k}>
              {SECTION_KIND_NAMES[k]}
            </option>
          ))}
        </Select>
        <span style={{ flex: 1 }} />
        <IconButton
          aria-label={`Delete ${section.label}`}
          title={lastSection ? "A song must keep at least one section" : `Delete ${section.label}`}
          tone="danger"
          disabled={lastSection}
          onClick={deleteSection}
        >
          <Trash2 size={14} aria-hidden />
        </IconButton>
      </div>
      <SlideThumbGrid
        slides={cards}
        selectedId={slide?.id ?? null}
        onSelect={onSelectSlide}
        onReorder={(from, to) => onChange((d) => moveSlideWithin(d, section.id, from, to))}
        onAdd={addSlide}
        addLabel="Add slide"
        menuItems={menuItems}
        minCardWidth={150}
      />
      {slide && (
        <div style={{ borderTop: `1px solid ${colors.border}` }}>
          <SlideTextEditor
            key={slide.id}
            heading={`Edit slide ${slideIdx + 1}`}
            fields={LYRIC_FIELDS}
            value={{ text }}
            onChange={(v) => setSlideText(v.text ?? "")}
            budget={LYRIC_SLIDE_BUDGET}
          />
        </div>
      )}
    </div>
  );
}
