"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  BringToFront,
  SendToBack,
  type LucideIcon,
} from "lucide-react";
import type { Draft } from "immer";
import type { Layer, Template } from "@overlaysys/core";
import {
  ColorInput,
  FieldRow,
  FieldsPanel,
  InspectorSection,
  PropertyInspector,
  TEMPLATE_SIZE_PRESETS,
  dedupeFontFaces,
  fontUsage,
  templateSizePresetKey,
  useEditCoalescer,
  type AlignMode,
  type PickFromLibraryFn,
  type ZMove,
} from "@overlaysys/editor-kit";
import { Button, IconButton, NumberInput, Select, Switch, colors, fontSize } from "@overlaysys/ui";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { templateRole, type TemplateUse } from "@/lib/templateRoles";

type Recipe = (d: Draft<Template>) => void;
type Tab = "layer" | "template";

/**
 * The designer's right column: a "Layer" tab (the selection's properties)
 * and a permanent "Template" tab (settings, fonts, fields), so template
 * settings stay reachable while a layer is selected.
 */
export function DesignerInspector({
  draft,
  selectedLayers,
  selectedLayerId,
  onCommit,
  onLive,
  onPushHistory,
  onUpload,
  resolveUrl,
  onPickFromLibrary,
  onAlign,
  onDistribute,
  onZ,
}: {
  draft: Template;
  selectedLayers: Layer[];
  selectedLayerId: string | null;
  onCommit: (r: Recipe) => void;
  onLive: (r: Recipe) => void;
  onPushHistory: () => void;
  onUpload: (file: File) => Promise<string>;
  resolveUrl?: (src: string) => string;
  /** Opens the Media library for a photo or video source; absent hides "Choose from Media". */
  onPickFromLibrary?: PickFromLibraryFn;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: "x" | "y") => void;
  onZ: (to: ZMove) => void;
}) {
  const hasSelection = selectedLayers.length > 0;
  const [tab, setTab] = useState<Tab>(hasSelection ? "layer" : "template");
  // Selecting a layer shows its properties; clearing the selection shows the template.
  // Keyed on the primary id too, so picking another layer from the Template tab shows that layer.
  useEffect(() => setTab(hasSelection ? "layer" : "template"), [hasSelection, selectedLayerId]);
  const primary = selectedLayers.find((l) => l.id === selectedLayerId) ?? selectedLayers[0] ?? null;
  const subtitle = tab === "layer" ? (selectedLayers.length > 1 ? `${selectedLayers.length} layers` : (primary?.name ?? "")) : "";

  return (
    <section style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: colors.surface }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px 0", borderBottom: `1px solid ${colors.border}`, minWidth: 0 }}>
        <div role="tablist" aria-label="Inspector" style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <TabButton id="layer" active={tab} onSelect={setTab}>
            Layer
          </TabButton>
          <TabButton id="template" active={tab} onSelect={setTab}>
            Template
          </TabButton>
        </div>
        {subtitle && (
          <span style={{ fontSize: fontSize.xs, color: colors.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
            {subtitle}
          </span>
        )}
      </div>
      <div
        role="tabpanel"
        id={`inspector-panel-${tab}`}
        aria-labelledby={`inspector-tab-${tab}`}
        style={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: "auto", overflowX: "hidden", padding: "10px 12px 12px" }}
      >
        {tab === "layer" ? (
          !hasSelection ? (
            <p style={{ margin: 0, fontSize: fontSize.sm, color: colors.textDim, lineHeight: 1.5 }}>
              Select a layer on the canvas or in Layers to edit it.
            </p>
          ) : (
            <>
              <ArrangeBar count={selectedLayers.length} onAlign={onAlign} onDistribute={onDistribute} onZ={onZ} />
              {selectedLayers.length === 1 ? (
                <PropertyInspector
                  template={draft}
                  selectedId={selectedLayerId}
                  onCommit={onCommit}
                  onLive={onLive}
                  onPushHistory={onPushHistory}
                  onUpload={onUpload}
                  resolveUrl={resolveUrl}
                  onPickFromLibrary={onPickFromLibrary}
                />
              ) : (
                <p style={{ margin: 0, fontSize: fontSize.xs, color: colors.textDim, lineHeight: 1.5 }}>
                  Arrows nudge (Shift = 10px) · ⌘D duplicate · ⌘C / ⌘V copy and paste · Delete removes.
                </p>
              )}
            </>
          )
        ) : (
          <>
            <TemplateSettings template={draft} onCommit={onCommit} onLive={onLive} />
            <EmbeddedFonts template={draft} onCommit={onCommit} />
            <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 10 }}>
              <FieldsPanel
                template={draft}
                onCommit={onCommit}
                onLive={onLive}
                onUpload={onUpload}
                resolveUrl={resolveUrl}
                onPickFromLibrary={onPickFromLibrary}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function TabButton({ id, active, onSelect, children }: { id: Tab; active: Tab; onSelect: (t: Tab) => void; children: ReactNode }) {
  const on = id === active;
  return (
    <button
      type="button"
      role="tab"
      id={`inspector-tab-${id}`}
      aria-selected={on}
      aria-controls={`inspector-panel-${id}`}
      tabIndex={on ? 0 : -1}
      onClick={() => onSelect(id)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          const next: Tab = id === "layer" ? "template" : "layer";
          onSelect(next);
          document.getElementById(`inspector-tab-${next}`)?.focus();
        }
      }}
      style={{
        height: 30,
        padding: "0 8px",
        background: "transparent",
        border: "none",
        borderBottom: `2px solid ${on ? colors.accent : "transparent"}`,
        marginBottom: -1,
        color: on ? colors.text : colors.textDim,
        fontSize: fontSize.md,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// ───── Arrange ──────────────────────────────────────────────────────────────

const ALIGN_BUTTONS: { mode: AlignMode; label: string; Icon: LucideIcon }[] = [
  { mode: "left", label: "Left", Icon: AlignStartVertical },
  { mode: "hcenter", label: "Center", Icon: AlignCenterVertical },
  { mode: "right", label: "Right", Icon: AlignEndVertical },
  { mode: "top", label: "Top", Icon: AlignStartHorizontal },
  { mode: "vcenter", label: "Middle", Icon: AlignCenterHorizontal },
  { mode: "bottom", label: "Bottom", Icon: AlignEndHorizontal },
];

/** Align / distribute / z-order for the selection. One layer aligns to the canvas (or its group). */
function ArrangeBar({
  count,
  onAlign,
  onDistribute,
  onZ,
}: {
  count: number;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: "x" | "y") => void;
  onZ: (to: ZMove) => void;
}) {
  const target = count === 1 ? " to canvas" : "";
  return (
    <InspectorSection title={count === 1 ? "Align to canvas" : "Arrange"} first>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {ALIGN_BUTTONS.map(({ mode, label, Icon }) => (
          <IconButton key={mode} size={28} aria-label={`Align ${label.toLowerCase()}${target}`} title={`Align ${label.toLowerCase()}`} onClick={() => onAlign(mode)}>
            <Icon size={14} aria-hidden />
          </IconButton>
        ))}
        {count >= 3 && (
          <>
            <IconButton size={28} aria-label="Distribute horizontally" title="Distribute horizontally" onClick={() => onDistribute("x")}>
              <AlignHorizontalDistributeCenter size={14} aria-hidden />
            </IconButton>
            <IconButton size={28} aria-label="Distribute vertically" title="Distribute vertically" onClick={() => onDistribute("y")}>
              <AlignVerticalDistributeCenter size={14} aria-hidden />
            </IconButton>
          </>
        )}
        <IconButton size={28} aria-label="Bring to front (⇧⌘])" title="Bring to front (⇧⌘])" onClick={() => onZ("top")}>
          <BringToFront size={14} aria-hidden />
        </IconButton>
        <IconButton size={28} aria-label="Send to back (⇧⌘[)" title="Send to back (⇧⌘[)" onClick={() => onZ("bottom")}>
          <SendToBack size={14} aria-hidden />
        </IconButton>
      </div>
    </InspectorSection>
  );
}

// ───── Template settings ────────────────────────────────────────────────────

const USE_LABEL: Record<TemplateUse | "other", string> = {
  graphic: "Graphic",
  lyric: "Lyric",
  scripture: "Scripture",
  title: "Title",
  other: "Not suggested (name starts with “Old”)",
};

function TemplateSettings({ template, onCommit: commitStep, onLive }: { template: Template; onCommit: (r: Recipe) => void; onLive: (r: Recipe) => void }) {
  // Typing makes one undo step per field edit, not one per keystroke.
  const { commit: onCommit, handlers } = useEditCoalescer(commitStep, onLive);
  const seconds = template.autoOutMs && template.autoOutMs > 0 ? template.autoOutMs / 1000 : 0;
  const channelConfigs = useResolvedChannelConfigs();
  const channelChoices = useMemo(() => channelConfigs.filter((c) => !c.mirrorOf), [channelConfigs]);
  const blink = template.blinkOnTake;
  const presetKey = templateSizePresetKey(template.size);
  const [customSize, setCustomSize] = useState(false);
  const showCustom = customSize || presetKey === "custom";
  const inferred = templateRole({ name: template.name });

  function setSize(w: number, h: number) {
    if (w === template.size.w && h === template.size.h) return;
    // Layers keep their positions; nothing is scaled.
    onCommit((d) => {
      d.size = { w, h };
    });
  }

  return (
    <div {...handlers}>
      <InspectorSection title="Template" first>
        <FieldRow label="Used for" hint="Where this template is suggested (song, scripture and title pickers)">
          {(id) => (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <Select
                id={id}
                value={template.role ?? "auto"}
                onChange={(e) => {
                  const v = e.target.value as TemplateUse | "auto";
                  onCommit((d) => {
                    if (v === "auto") delete d.role;
                    else d.role = v;
                  });
                }}
              >
                <option value="auto">Auto</option>
                <option value="graphic">Graphic</option>
                <option value="lyric">Lyric</option>
                <option value="scripture">Scripture</option>
                <option value="title">Title</option>
              </Select>
              {!template.role && (
                <span style={{ fontSize: fontSize.xs, color: colors.textMuted }}>From the name: {USE_LABEL[inferred]}</span>
              )}
            </div>
          )}
        </FieldRow>
        <FieldRow label="Canvas">
          {(id) => (
            <Select
              id={id}
              value={showCustom ? "custom" : presetKey}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "custom") {
                  setCustomSize(true);
                  return;
                }
                setCustomSize(false);
                const p = TEMPLATE_SIZE_PRESETS.find((s) => `${s.w}x${s.h}` === v);
                if (p) setSize(p.w, p.h);
              }}
            >
              {TEMPLATE_SIZE_PRESETS.map((p) => (
                <option key={`${p.w}x${p.h}`} value={`${p.w}x${p.h}`}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </Select>
          )}
        </FieldRow>
        {showCustom && (
          <FieldRow label="Size">
            {(id) => (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 4 }}>
                <NumberInput id={id} size="sm" int min={1} aria-label="Canvas width" suffix="W" value={template.size.w} onCommit={(w) => setSize(Math.max(1, w), template.size.h)} />
                <NumberInput size="sm" int min={1} aria-label="Canvas height" suffix="H" value={template.size.h} onCommit={(h) => setSize(template.size.w, Math.max(1, h))} />
              </div>
            )}
          </FieldRow>
        )}
        <FieldRow label="Auto-out" hint="Clear this template this many seconds after it's taken; 0 is off">
          {(id) => (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 96 }}>
                <NumberInput
                  id={id}
                  size="sm"
                  min={0}
                  step={0.1}
                  precision={1}
                  suffix="s"
                  value={seconds}
                  onCommit={(v) => {
                    const next = Math.max(0, Math.round(v * 1000));
                    onCommit((d) => {
                      if (next <= 0) delete d.autoOutMs;
                      else d.autoOutMs = next;
                    });
                  }}
                />
              </div>
              {seconds === 0 && <span style={{ fontSize: fontSize.xs, color: colors.textMuted }}>Off</span>}
            </div>
          )}
        </FieldRow>
        <FieldRow label="Default channel" hint="Prefills the channel when this template is added to a rundown or taken">
          {(id) => (
            <Select
              id={id}
              value={template.defaultChannel ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onCommit((d) => {
                  if (!v) delete d.defaultChannel;
                  else d.defaultChannel = v;
                });
              }}
            >
              <option value="">None</option>
              {/* Keep an out-of-list value rather than silently dropping it when
                  the channel was removed or became a mirror. */}
              {template.defaultChannel && !channelChoices.some((c) => c.id === template.defaultChannel) && (
                <option value={template.defaultChannel}>{template.defaultChannel} (missing)</option>
              )}
              {channelChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </FieldRow>
        <FieldRow label="Blink on take" hint="Flash a colour over the output on each take. Re-taking blinks again; updates don't">
          {() => (
            <Switch
              aria-label="Blink on take"
              checked={blink?.enabled ?? false}
              onChange={(next) =>
                onCommit((d) => {
                  if (next) {
                    // Seed defaults the first time so the renderer has a usable config.
                    if (!d.blinkOnTake) d.blinkOnTake = { enabled: true, color: "#ffffff", durationMs: 500, count: 2 };
                    else d.blinkOnTake.enabled = true;
                  } else if (d.blinkOnTake) {
                    d.blinkOnTake.enabled = false;
                  }
                })
              }
            />
          )}
        </FieldRow>
        {/* Keep the saved blink values visible (and intact) while the feature is toggled off. */}
        {blink && (
          <>
            <FieldRow label="Blink color">
              {(id) => (
                <ColorInput
                  id={id}
                  label="Blink color"
                  value={blink.color}
                  onChange={(v) =>
                    onCommit((d) => {
                      if (d.blinkOnTake) d.blinkOnTake.color = v;
                    })
                  }
                />
              )}
            </FieldRow>
            <FieldRow label="Duration" hint="Length of one blink cycle">
              {(id) => (
                <div style={{ width: 120 }}>
                  <NumberInput
                    id={id}
                    size="sm"
                    int
                    min={50}
                    step={50}
                    suffix="ms"
                    value={blink.durationMs}
                    onCommit={(v) =>
                      onCommit((d) => {
                        if (d.blinkOnTake) d.blinkOnTake.durationMs = Math.max(50, Math.round(v));
                      })
                    }
                  />
                </div>
              )}
            </FieldRow>
            <FieldRow label="Blinks">
              {(id) => (
                <div style={{ width: 120 }}>
                  <NumberInput
                    id={id}
                    size="sm"
                    int
                    min={1}
                    max={20}
                    value={blink.count}
                    onCommit={(v) =>
                      onCommit((d) => {
                        if (d.blinkOnTake) d.blinkOnTake.count = Math.max(1, Math.min(20, Math.round(v)));
                      })
                    }
                  />
                </div>
              )}
            </FieldRow>
          </>
        )}
      </InspectorSection>
    </div>
  );
}

/** Fonts embedded in the template JSON, one row per family, with remove (they're never pruned otherwise). */
function EmbeddedFonts({ template, onCommit }: { template: Template; onCommit: (r: Recipe) => void }) {
  // Older templates can embed the same family twice; show it once.
  const fonts = dedupeFontFaces(template.fonts);
  if (fonts.length === 0) return null;
  return (
    <InspectorSection title="Embedded fonts">
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {fonts.map((f) => {
          const usedBy = fontUsage(template, f.family);
          const family = f.family.toLowerCase();
          return (
            <li key={family} style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 28, fontSize: fontSize.sm, minWidth: 0 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: f.family }} title={f.family}>
                {f.family}
              </span>
              {usedBy.length > 0 && (
                <span style={{ fontSize: fontSize.xs, color: colors.textMuted, flexShrink: 0 }} title={usedBy.join(", ")}>
                  {usedBy.length === 1 ? "1 layer" : `${usedBy.length} layers`}
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove font ${f.family}`}
                title={usedBy.length > 0 ? `Remove — ${usedBy.join(", ")} will fall back to an installed font` : "Remove font"}
                onClick={() =>
                  onCommit((d) => {
                    d.fonts = d.fonts.filter((x) => x.family.toLowerCase() !== family);
                  })
                }
              >
                Remove
              </Button>
            </li>
          );
        })}
      </ul>
    </InspectorSection>
  );
}
