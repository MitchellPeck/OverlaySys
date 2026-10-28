"use client";
import { useRef, useState, type CSSProperties } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { Button, colors, IconButton, radius } from "@overlaysys/ui";
import { TemplateThumbnail } from "@/lib/thumbnails/TemplateThumbnail";
import { sectionChipTextColor } from "./sectionColors";
import { useContextMenu, type MenuItem } from "./menuCompat";

export type SlideCard = {
  id: string;
  templateId: string | null;
  data: Record<string, string>;
  caption?: string;
  group?: { label: string; color: string } | null;
  badge?: string;
};

const firstLine = (data: Record<string, string>) =>
  (Object.values(data).find((v) => v.trim()) ?? "").split("\n")[0] ?? "";

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
            cursor: "pointer",
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
              <div
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={s.caption ?? `Slide ${i + 1}`}
                onClick={() => p.onSelect(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    p.onSelect(s.id);
                  }
                }}
                style={frame}
              >
                {s.templateId ? (
                  <TemplateThumbnail templateId={s.templateId} data={s.data} width={minW} />
                ) : (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "#111",
                      color: "#ddd",
                      fontSize: 12,
                      padding: 8,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {firstLine(s.data)}
                  </div>
                )}
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
                    }}
                  >
                    {s.badge}
                  </span>
                )}
                {showMore && (
                  <div style={{ position: "absolute", right: 4, top: 4 }} onClick={(e) => e.stopPropagation()}>
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
      {p.onAdd && (
        <div style={{ marginTop: 12 }}>
          <Button size="sm" onClick={p.onAdd} icon={<Plus size={14} />}>
            {p.addLabel ?? "+ slide"}
          </Button>
        </div>
      )}
      {ctx.menu}
    </div>
  );
}
