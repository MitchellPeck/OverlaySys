"use client";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Film, Image as ImageIcon, MoreHorizontal, Plus } from "lucide-react";
import { mediaObjectPosition, type MediaFit, type MediaPosition } from "@overlaysys/core";
import { Button, colors, IconButton, radius, useContextMenu, type MenuItem } from "@overlaysys/ui";
import { TemplateThumbnail } from "@/lib/thumbnails/TemplateThumbnail";
import { useTemplateBody } from "@/lib/thumbnails/useTemplateBody";
import { sectionChipTextColor } from "./sectionColors";

export type SlideCard = {
  id: string;
  templateId: string | null;
  data: Record<string, string>;
  caption?: string;
  group?: { label: string; color: string } | null;
  badge?: string;
  /**
   * A photo or video card: its thumbnail URL (null when there is none, e.g. a
   * video without a poster), drawn with the size/position it plays with (default Fit inside, centred).
   */
  media?: { src: string | null; type: "image" | "video"; fit?: MediaFit; position?: MediaPosition };
};

/** A photo/video card's picture, or a type icon when there is none or it fails to load. */
function MediaFill({ src, type, fit = "contain", position = "center" }: NonNullable<SlideCard["media"]>) {
  const [failed, setFailed] = useState<string | null>(null);
  const Icon = type === "video" ? Film : ImageIcon;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#888" }}>
      {src && failed !== src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} style={{ width: "100%", height: "100%", objectFit: fit, objectPosition: mediaObjectPosition(position) }} />
      ) : (
        <Icon size={24} aria-hidden />
      )}
    </div>
  );
}

const firstLine = (data: Record<string, string>) =>
  (Object.values(data).find((v) => v.trim()) ?? "").split("\n")[0] ?? "";

/** Fills its 16:9 cell; templates of another aspect are letterboxed, never clipped. */
function FitThumb({ templateId, data }: { templateId: string; data: Record<string, string> }) {
  const box = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const { template } = useTemplateBody(templateId);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setDims({ w: el.clientWidth, h: el.clientHeight });
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const size = template?.size ?? { w: 16, h: 9 };
  const width = dims ? Math.max(1, Math.floor(Math.min(dims.w, (dims.h * size.w) / size.h))) : 0;
  return (
    <div ref={box} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {width > 0 && <TemplateThumbnail templateId={templateId} data={data} width={width} />}
    </div>
  );
}

export function SlideThumbGrid(p: {
  slides: SlideCard[];
  selectedId: string | null;
  onSelect(id: string): void;
  onReorder?(from: number, to: number): void;
  onAdd?(): void;
  addLabel?: string;
  menuItems?(id: string): MenuItem[];
  minCardWidth?: number;
  emptyText?: string;
  /** More buttons beside the add button (or alone when there is none). */
  extraActions?: ReactNode;
}) {
  const minW = p.minCardWidth ?? 200;
  const ctx = useContextMenu();
  const dragFrom = useRef<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  if (p.slides.length === 0 && !p.onAdd) {
    return <div style={{ padding: 12, fontSize: 12, color: colors.textMuted }}>{p.emptyText ?? "No slides."}</div>;
  }

  return (
    <div style={{ padding: 8 }}>
      {p.slides.length === 0 && (
        <div style={{ padding: "4px 4px 8px", fontSize: 12, color: colors.textMuted }}>{p.emptyText ?? "No slides."}</div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${minW}px, 1fr))`, gap: 12 }}>
        {p.slides.map((s, i) => {
          const selected = s.id === p.selectedId;
          const items = p.menuItems?.(s.id) ?? [];
          const showMore = items.length > 0 && (hover === s.id || focus === s.id || selected);
          const frame: CSSProperties = {
            position: "relative",
            border: `2px solid ${selected ? colors.accent : "transparent"}`,
            borderRadius: radius.md,
            overflow: "hidden",
            background: "#000",
            aspectRatio: "16 / 9",
            outline: overIdx === i ? `2px dashed ${colors.accent}` : undefined,
          };
          return (
            <div
              key={s.id}
              draggable={!!p.onReorder}
              onDragStart={() => {
                dragFrom.current = i;
              }}
              onDragOver={(e) => {
                if (p.onReorder && dragFrom.current !== null) {
                  e.preventDefault();
                  setOverIdx(i);
                }
              }}
              onDragLeave={() => setOverIdx((o) => (o === i ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragFrom.current;
                dragFrom.current = null;
                setOverIdx(null);
                if (from !== null && from !== i) p.onReorder?.(from, i);
              }}
              onDragEnd={() => {
                dragFrom.current = null;
                setOverIdx(null);
              }}
              onMouseEnter={() => setHover(s.id)}
              onMouseLeave={() => setHover((h) => (h === s.id ? null : h))}
              onFocus={() => setFocus(s.id)}
              onBlur={() => setFocus((f) => (f === s.id ? null : f))}
              onContextMenu={(e) => {
                if (items.length) ctx.open(e, items);
              }}
              style={{ minWidth: 0 }}
            >
              <div style={{ minHeight: 20, marginBottom: 4 }}>
                {s.group && (
                  <span
                    style={{
                      display: "inline-block",
                      padding: "1px 6px",
                      borderRadius: radius.pill,
                      fontSize: 11,
                      background: s.group.color,
                      color: sectionChipTextColor(s.group.color),
                    }}
                  >
                    {s.group.label}
                  </span>
                )}
              </div>
              <div style={frame}>
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={s.caption ?? `Slide ${i + 1}`}
                  onClick={() => p.onSelect(s.id)}
                  style={{ position: "absolute", inset: 0, padding: 0, border: 0, background: "transparent", cursor: "pointer", display: "block" }}
                >
                  {s.media ? (
                    <MediaFill {...s.media} />
                  ) : s.templateId ? (
                    <FitThumb templateId={s.templateId} data={s.data} />
                  ) : (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "#111",
                        color: "#ddd",
                        fontSize: 12,
                        padding: 8,
                        textAlign: "left",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {firstLine(s.data)}
                    </div>
                  )}
                </button>
                {s.badge && (
                  <span
                    style={{
                      position: "absolute",
                      left: 4,
                      bottom: 4,
                      padding: "0 5px",
                      fontSize: 11,
                      borderRadius: radius.sm,
                      background: "rgba(0,0,0,.7)",
                      color: "#fff",
                      pointerEvents: "none",
                    }}
                  >
                    {s.badge}
                  </span>
                )}
                {showMore && (
                  <div style={{ position: "absolute", right: 4, top: 4 }}>
                    <IconButton aria-label={`Slide ${i + 1} actions`} onClick={(e) => ctx.open(e.currentTarget, items)}>
                      <MoreHorizontal size={14} />
                    </IconButton>
                  </div>
                )}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  color: selected ? colors.text : colors.textDim,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {s.caption ?? `Slide ${i + 1}`}
              </div>
            </div>
          );
        })}
      </div>
      {(p.onAdd || p.extraActions) && (
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {p.onAdd && (
            <Button size="sm" onClick={p.onAdd} icon={<Plus size={14} />}>
              {p.addLabel ?? "+ slide"}
            </Button>
          )}
          {p.extraActions}
        </div>
      )}
      {ctx.menu}
    </div>
  );
}
