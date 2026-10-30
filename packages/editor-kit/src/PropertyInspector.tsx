"use client";

import type { Draft } from "immer";
import { useEffect, useId, useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  Blend,
  Copy,
  Italic,
  RotateCw,
  Underline,
} from "lucide-react";
import type { Layer, Template, Transform, MaskShape, ColorValue, CornerRadius, Shadow, TextFit, ClipBy } from "@overlaysys/core";
import {
  Button,
  Checkbox,
  IconButton,
  Input,
  NumberInput,
  SegmentedControl,
  Select,
  Switch,
  colors,
  fontSize,
  toast,
} from "@overlaysys/ui";
import { findLayer } from "./utils";
import { ColorInput } from "./ColorInput";
import { FontInput } from "./FontInput";
import { ImageInput } from "./ImageInput";
import { VideoInput } from "./VideoInput";
import { GradientStops } from "./GradientStops";
import { FieldRow } from "./FieldRow";
import { FontWeightSelect } from "./FontWeightSelect";
import { AutoTextarea } from "./AutoTextarea";
import { numericFontWeight, weightsFromDescriptors } from "./fontWeights";
import { useEditCoalescer } from "./editCoalescer";

type CommitFn = (recipe: (d: Draft<Template>) => void) => void;
type PushHistoryFn = () => void;
type UploadFn = (file: File) => Promise<string>;
/** Opens the host's media library for a photo or video; resolves with its URL, or null when cancelled. */
export type PickFromLibraryFn = (kind: "image" | "video") => Promise<{ url: string } | null>;

type Props = {
  template: Template;
  selectedId: string | null;
  onCommit: CommitFn;
  /**
   * Apply without a new undo step. With it, typing in a field updates the
   * canvas live but makes one undo step per field edit, not per keystroke.
   */
  onLive?: CommitFn;
  onPushHistory?: PushHistoryFn;
  /** Optional uploader for image/video/font file pickers. Without it,
   * picked files fall back to inline data URLs. */
  onUpload?: UploadFn;
  /** Turns a stored asset path into a URL this page can load (previews only). */
  resolveUrl?: (src: string) => string;
  /** When provided, image and video sources offer "From library". */
  onPickFromLibrary?: PickFromLibraryFn;
};

type ClipHide = ClipBy["hide"];

/**
 * The selected layer's properties, in the designer's fixed section order:
 * Layer, Content, Text, Transform, Appearance, Clip. Built to fit a 300 px
 * column: nothing scrolls sideways.
 */
export function PropertyInspector({ template, selectedId, onCommit: commitStep, onLive, onPushHistory, onUpload, resolveUrl, onPickFromLibrary }: Props) {
  const { commit: onCommit, handlers } = useEditCoalescer(commitStep, onLive);
  if (!selectedId) {
    return <p style={{ color: colors.textDim, fontSize: fontSize.sm, margin: 0, padding: "8px 0" }}>Select a layer to inspect.</p>;
  }
  const layer = findLayer(template.layers, selectedId);
  if (!layer) return null;

  const edit = (fn: (l: Draft<Layer>) => void) =>
    onCommit((d) => {
      const l = findInDraft(d.layers, selectedId);
      if (l) fn(l);
    });
  const patchTransform = (patch: Partial<Transform>) => edit((l) => void Object.assign(l.transform, patch));
  const patchLayer = (patch: Partial<Layer>) => edit((l) => void Object.assign(l, patch));

  return (
    <div style={{ minWidth: 0, overflowX: "hidden" }} {...handlers}>
      <Section title="Layer" first>
        <FieldRow label="Name">
          {(id) => (
            <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
              <Input
                id={id}
                value={layer.name}
                onChange={(e) => patchLayer({ name: e.target.value } as Partial<Layer>)}
                onKeyDown={blurOnEnter}
                style={{ flex: 1, minWidth: 0 }}
              />
              {/* Ids are never shown; they can only be copied. */}
              <IconButton
                size={24}
                aria-label={`Copy id of ${layer.name}`}
                title="Copy id"
                style={{ border: "none", color: colors.textDim }}
                onClick={() => void copyId(layer.id)}
              >
                <Copy size={14} aria-hidden />
              </IconButton>
            </div>
          )}
        </FieldRow>
        <div style={{ display: "flex", alignItems: "center", gap: 16, minHeight: 28, paddingLeft: 88 }}>
          <Switch checked={layer.visible} onChange={(v) => patchLayer({ visible: v } as Partial<Layer>)} label="Visible" />
          <span title="A locked layer can't be dragged, nudged or aligned on the canvas">
            <Switch
              checked={layer.locked === true}
              onChange={(v) =>
                edit((l) => {
                  if (v) l.locked = true;
                  else delete l.locked;
                })
              }
              label="Locked"
            />
          </span>
        </div>
      </Section>

      <Section title="Content">
        <ContentSection
          layer={layer}
          template={template}
          patchLayer={patchLayer}
          onUpload={onUpload}
          resolveUrl={resolveUrl}
          onPickFromLibrary={onPickFromLibrary}
        />
      </Section>

      {layer.type === "text" && (
        <Section title="Text">
          <TextSection layer={layer} template={template} onCommit={onCommit} edit={edit} patchLayer={patchLayer} onUpload={onUpload} />
        </Section>
      )}

      <Section title="Transform">
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", columnGap: 8, rowGap: 4 }}>
          <GridNumber label="X" name="X" value={layer.transform.x} onCommit={(v) => patchTransform({ x: v })} />
          <GridNumber label="Y" name="Y" value={layer.transform.y} onCommit={(v) => patchTransform({ y: v })} />
          <GridNumber label="W" name="Width" value={layer.transform.w ?? 0} min={0} onCommit={(v) => patchTransform({ w: v })} />
          <GridNumber label="H" name="Height" value={layer.transform.h ?? 0} min={0} onCommit={(v) => patchTransform({ h: v })} />
          <GridNumber
            label={<RotateCw size={12} aria-hidden />}
            name="Rotation"
            value={layer.transform.rotation}
            precision={2}
            suffix="°"
            onCommit={(v) => patchTransform({ rotation: v })}
          />
          <GridNumber
            label={<Blend size={12} aria-hidden />}
            name="Opacity"
            value={Math.round(layer.transform.opacity * 100)}
            int
            min={0}
            max={100}
            suffix="%"
            onCommit={(v) => patchTransform({ opacity: clamp01(v / 100) })}
          />
        </div>
      </Section>

      <Section title="Appearance">
        <AppearanceSection layer={layer} template={template} onCommit={onCommit} patchLayer={patchLayer} patchTransform={patchTransform} onPushHistory={onPushHistory} />
      </Section>

      <Section title="Clip">
        <ClipSection template={template} layer={layer} edit={edit} />
      </Section>
    </div>
  );
}

// ───── Content ──────────────────────────────────────────────────────────────

type EditFn = (fn: (l: Draft<Layer>) => void) => void;
type PatchLayerFn = (patch: Partial<Layer>) => void;

const FIT_OPTIONS: { value: "cover" | "contain" | "fill"; label: string }[] = [
  { value: "cover", label: "Cover" },
  { value: "contain", label: "Contain" },
  { value: "fill", label: "Fill" },
];

function FitRow({ value, onChange }: { value: "cover" | "contain" | "fill"; onChange: (v: "cover" | "contain" | "fill") => void }) {
  return (
    <FieldRow label="Fit">
      {() => <SegmentedControl size="sm" aria-label="Fit" value={value} options={FIT_OPTIONS} onChange={onChange} />}
    </FieldRow>
  );
}

function ContentSection({
  layer,
  template,
  patchLayer,
  onUpload,
  resolveUrl,
  onPickFromLibrary,
}: {
  layer: Layer;
  template: Template;
  patchLayer: PatchLayerFn;
  onUpload?: UploadFn;
  resolveUrl?: (src: string) => string;
  onPickFromLibrary?: PickFromLibraryFn;
}) {
  switch (layer.type) {
    case "text":
      return (
        <BindingControl
          template={template}
          label="Text"
          value={layer.content}
          // Time fields render as a string each frame, so they're a valid
          // source for a text layer's content — that's how countdowns /
          // clocks attach to a styled text layer.
          allowedTypes={["text", "time"]}
          onChange={(v) => patchLayer({ content: v } as Partial<Layer>)}
        />
      );
    case "image":
      return (
        <>
          <BindingControl
            template={template}
            label="Image"
            value={layer.src}
            allowedTypes={["image"]}
            literalKind="image"
            onUpload={onUpload}
            resolveUrl={resolveUrl}
            onPickFromLibrary={onPickFromLibrary}
            onChange={(v) => patchLayer({ src: v } as Partial<Layer>)}
          />
          <FitRow value={layer.fit} onChange={(fit) => patchLayer({ fit } as Partial<Layer>)} />
        </>
      );
    case "video":
      return (
        <>
          <BindingControl
            template={template}
            label="Video"
            value={layer.src}
            allowedTypes={["video"]}
            literalKind="video"
            onUpload={onUpload}
            resolveUrl={resolveUrl}
            onPickFromLibrary={onPickFromLibrary}
            onChange={(v) => patchLayer({ src: v } as Partial<Layer>)}
          />
          <FitRow value={layer.fit} onChange={(fit) => patchLayer({ fit } as Partial<Layer>)} />
          <FieldRow label="Playback">
            {() => (
              <div style={{ display: "flex", flexWrap: "wrap", columnGap: 12 }}>
                <Checkbox checked={layer.loop} onChange={(v) => patchLayer({ loop: v } as Partial<Layer>)} label="Loop" />
                <Checkbox checked={layer.autoplay} onChange={(v) => patchLayer({ autoplay: v } as Partial<Layer>)} label="Autoplay" />
                <Checkbox checked={layer.muted} onChange={(v) => patchLayer({ muted: v } as Partial<Layer>)} label="Muted" />
              </div>
            )}
          </FieldRow>
          <FieldRow label="Speed">
            {(id) => (
              <NumberInput
                id={id}
                size="sm"
                min={0.25}
                max={4}
                step={0.01}
                precision={2}
                suffix="×"
                value={layer.playbackRate}
                onCommit={(v) => patchLayer({ playbackRate: v || 1 } as Partial<Layer>)}
              />
            )}
          </FieldRow>
          <FieldRow label="Trim" hint="Start and end in seconds; an end of 0 plays to the end">
            {(id) => (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 4 }}>
                <NumberInput
                  id={id}
                  size="sm"
                  aria-label="Trim start (s)"
                  min={0}
                  step={0.01}
                  precision={2}
                  suffix="s"
                  value={layer.trimStart}
                  onCommit={(v) => patchLayer({ trimStart: Math.max(0, v) } as Partial<Layer>)}
                />
                <NumberInput
                  size="sm"
                  aria-label="Trim end (s, 0 = full)"
                  min={0}
                  step={0.01}
                  precision={2}
                  suffix="s"
                  value={layer.trimEnd}
                  onCommit={(v) => patchLayer({ trimEnd: Math.max(0, v) } as Partial<Layer>)}
                />
              </div>
            )}
          </FieldRow>
          <FieldRow label="Crop" hint="Left, top, right, bottom as a fraction of the frame (0–1)">
            {() => (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4 }}>
                {(["left", "top", "right", "bottom"] as const).map((side) => (
                  <NumberInput
                    key={side}
                    size="sm"
                    aria-label={`Crop ${side} (0–1)`}
                    min={0}
                    max={1}
                    step={0.01}
                    precision={2}
                    value={layer.crop[side]}
                    onCommit={(v) => patchLayer({ crop: { ...layer.crop, [side]: Math.max(0, Math.min(1, v)) } } as Partial<Layer>)}
                  />
                ))}
              </div>
            )}
          </FieldRow>
        </>
      );
    case "shape":
      return (
        <>
          <FieldRow label="Shape">
            {(id) => (
              <Select
                id={id}
                value={layer.shape}
                onChange={(e) => patchLayer({ shape: e.target.value as typeof layer.shape } as Partial<Layer>)}
              >
                <option value="rect">Rectangle</option>
                <option value="ellipse">Ellipse</option>
                <option value="triangle">Triangle</option>
                <option value="polygon">Polygon</option>
                <option value="star">Star</option>
              </Select>
            )}
          </FieldRow>
          {layer.shape === "polygon" && (
            <NumberRow label="Sides" value={layer.sides} int onChange={(v) => patchLayer({ sides: Math.max(3, Math.min(20, Math.round(v))) } as Partial<Layer>)} />
          )}
          {layer.shape === "star" && (
            <>
              <NumberRow label="Points" value={layer.starPoints} int onChange={(v) => patchLayer({ starPoints: Math.max(3, Math.min(20, Math.round(v))) } as Partial<Layer>)} />
              <NumberRow
                label="Inner ratio"
                value={layer.starInnerRatio}
                step={0.01}
                precision={2}
                onChange={(v) => patchLayer({ starInnerRatio: Math.max(0.05, Math.min(0.95, v)) } as Partial<Layer>)}
              />
            </>
          )}
        </>
      );
    case "group":
      return (
        <FieldRow label="Children">
          {() => <span style={{ fontSize: fontSize.sm, color: colors.textDim }}>{layer.children.length} {layer.children.length === 1 ? "layer" : "layers"}</span>}
        </FieldRow>
      );
  }
}

// ───── Text ─────────────────────────────────────────────────────────────────

function TextSection({
  layer,
  template,
  onCommit,
  edit,
  patchLayer,
  onUpload,
}: {
  layer: Extract<Layer, { type: "text" }>;
  template: Template;
  onCommit: CommitFn;
  edit: EditFn;
  patchLayer: PatchLayerFn;
  onUpload?: UploadFn;
}) {
  const style = layer.style;
  const setStyle = (p: Partial<typeof style>) => patchLayer({ style: { ...style, ...p } } as Partial<Layer>);
  const weights = useKnownWeights(style.fontFamily);
  return (
    <>
      <FieldRow label="Font">
        {(id) => (
          <FontInput
            id={id}
            value={style.fontFamily}
            templateFonts={template.fonts}
            onUpload={onUpload}
            onChange={(family) => setStyle({ fontFamily: family })}
            onAddFont={(entry) =>
              onCommit((d) => {
                // Re-adding a family replaces it rather than embedding it twice.
                const i = d.fonts.findIndex((f) => f.family.toLowerCase() === entry.family.toLowerCase());
                if (i >= 0) d.fonts[i] = entry;
                else d.fonts.push(entry);
              })
            }
          />
        )}
      </FieldRow>
      <FieldRow label="Size">
        {(id) => (
          <NumberInput id={id} size="sm" int min={1} suffix="px" value={style.fontSize} onCommit={(v) => setStyle({ fontSize: Math.max(1, v) })} />
        )}
      </FieldRow>
      <FieldRow label="Weight">
        {(id) => (
          <FontWeightSelect id={id} value={numericFontWeight(style.fontWeight)} available={weights} onChange={(w) => setStyle({ fontWeight: w })} />
        )}
      </FieldRow>
      <FieldRow label="Style">
        {() => (
          <div style={{ display: "flex", gap: 4 }}>
            <ToggleIcon label="Italic" pressed={style.italic} onClick={() => setStyle({ italic: !style.italic })}>
              <Italic size={14} aria-hidden />
            </ToggleIcon>
            <ToggleIcon label="Underline" pressed={style.underline} onClick={() => setStyle({ underline: !style.underline })}>
              <Underline size={14} aria-hidden />
            </ToggleIcon>
          </div>
        )}
      </FieldRow>
      <BindingControl
        template={template}
        label="Color"
        value={style.color}
        allowedTypes={["color"]}
        literalKind="color"
        onChange={(v) => setStyle({ color: v as ColorValue })}
      />
      <FieldRow label="Align">
        {() => (
          <SegmentedControl
            size="sm"
            aria-label="Align"
            value={style.align}
            onChange={(align) => setStyle({ align })}
            options={[
              { value: "left", label: <AlignLeft size={14} aria-label="Left" />, title: "Left" },
              { value: "center", label: <AlignCenter size={14} aria-label="Center" />, title: "Center" },
              { value: "right", label: <AlignRight size={14} aria-label="Right" />, title: "Right" },
            ]}
          />
        )}
      </FieldRow>
      <FieldRow label="Vertical align">
        {() => (
          <SegmentedControl
            size="sm"
            aria-label="Vertical align"
            value={style.verticalAlign}
            onChange={(verticalAlign) => setStyle({ verticalAlign })}
            options={[
              { value: "top", label: <AlignStartHorizontal size={14} aria-label="Top" />, title: "Top" },
              { value: "middle", label: <AlignCenterHorizontal size={14} aria-label="Middle" />, title: "Middle" },
              { value: "bottom", label: <AlignEndHorizontal size={14} aria-label="Bottom" />, title: "Bottom" },
            ]}
          />
        )}
      </FieldRow>
      <FieldRow label="Overflow" hint="What happens when the text doesn't fit the layer box">
        {(id) => (
          <Select
            id={id}
            value={layer.fit ?? "none"}
            onChange={(e) => {
              const fit = e.target.value as TextFit;
              edit((l) => {
                if (l.type !== "text") return;
                if (fit === "none") delete l.fit;
                else l.fit = fit;
              });
            }}
          >
            <option value="none">Clip</option>
            <option value="shrink">Shrink to fit</option>
            <option value="ellipsis">Ellipsis (…)</option>
          </Select>
        )}
      </FieldRow>
      {layer.fit === "shrink" && (
        <NumberRow
          label="Min size"
          value={layer.minFontSize ?? 12}
          int
          suffix="px"
          onChange={(v) =>
            edit((l) => {
              if (l.type === "text") l.minFontSize = Math.max(1, v);
            })
          }
        />
      )}
    </>
  );
}

/** The weights the browser has registered for `family` (its first name), or undefined if it isn't known. */
function useKnownWeights(family: string): number[] | undefined {
  const name = firstFamily(family);
  const [weights, setWeights] = useState<number[] | undefined>(undefined);
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    const read = () => {
      const descs: string[] = [];
      document.fonts.forEach((f) => {
        if (firstFamily(f.family) === name) descs.push(f.weight);
      });
      setWeights(weightsFromDescriptors(descs));
    };
    read();
    document.fonts.addEventListener?.("loadingdone", read);
    return () => document.fonts.removeEventListener?.("loadingdone", read);
  }, [name]);
  return weights;
}

function firstFamily(css: string): string {
  return (css.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "").toLowerCase();
}

function ToggleIcon({ label, pressed, onClick, children }: { label: string; pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <IconButton
      size={24}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      style={pressed ? { background: colors.brandFill, borderColor: colors.brandFill, color: colors.text } : undefined}
    >
      {children}
    </IconButton>
  );
}

// ───── Appearance ───────────────────────────────────────────────────────────

function AppearanceSection({
  layer,
  template,
  onCommit,
  patchLayer,
  patchTransform,
  onPushHistory,
}: {
  layer: Layer;
  template: Template;
  onCommit: CommitFn;
  patchLayer: PatchLayerFn;
  patchTransform: (p: Partial<Transform>) => void;
  onPushHistory?: PushHistoryFn;
}) {
  return (
    <>
      {layer.type === "shape" && (
        <>
          <FieldRow label="Fill">
            {() => (
              <SegmentedControl
                size="sm"
                aria-label="Fill"
                value={layer.fill.kind}
                options={[
                  { value: "solid", label: "Solid" },
                  { value: "linear-gradient", label: "Gradient" },
                ]}
                onChange={(kind) => {
                  if (kind === layer.fill.kind) return;
                  if (kind === "solid") patchLayer({ fill: { kind: "solid", color: "#ff3a3a" } } as Partial<Layer>);
                  else
                    patchLayer({
                      fill: {
                        kind: "linear-gradient",
                        angle: 90,
                        stops: [
                          { at: 0, color: "#ff3a3a" },
                          { at: 1, color: "#000000" },
                        ],
                      },
                    } as Partial<Layer>);
                }}
              />
            )}
          </FieldRow>
          {layer.fill.kind === "solid" && (
            <BindingControl
              template={template}
              label="Color"
              value={layer.fill.color}
              allowedTypes={["color"]}
              literalKind="color"
              onChange={(v) => patchLayer({ fill: { kind: "solid", color: v as ColorValue } } as Partial<Layer>)}
            />
          )}
          {layer.fill.kind === "linear-gradient" && (
            <>
              <NumberRow
                label="Angle"
                precision={2}
                suffix="°"
                value={layer.fill.angle}
                onChange={(v) => patchLayer({ fill: { ...layer.fill, kind: "linear-gradient", angle: v } } as Partial<Layer>)}
              />
              <div style={{ margin: "4px 0", minWidth: 0 }}>
                <GradientStops
                  stops={layer.fill.stops}
                  fields={template.fields}
                  onChange={(stops) =>
                    onCommit((d) => {
                      const l = findInDraft(d.layers, layer.id);
                      if (!l || l.type !== "shape" || l.fill.kind !== "linear-gradient") return;
                      l.fill.stops = stops;
                    })
                  }
                  onPushHistory={onPushHistory}
                />
              </div>
            </>
          )}
          {layer.shape === "rect" && (
            <CornerRadiusEditor value={layer.cornerRadius} onChange={(cr) => patchLayer({ cornerRadius: cr } as Partial<Layer>)} />
          )}
          <NumberRow label="Blur" value={layer.blur ?? 0} int suffix="px" onChange={(v) => patchLayer({ blur: Math.max(0, v) } as Partial<Layer>)} />
          <ShadowEditor shadow={layer.shadow} onChange={(s) => patchLayer({ shadow: s ?? undefined } as Partial<Layer>)} />
        </>
      )}
      <FieldRow label="Scale">
        {(id) => (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 4 }}>
            <NumberInput id={id} size="sm" aria-label="Scale X" step={0.01} precision={2} suffix="×" value={layer.transform.scaleX} onCommit={(v) => patchTransform({ scaleX: v })} />
            <NumberInput size="sm" aria-label="Scale Y" step={0.01} precision={2} suffix="×" value={layer.transform.scaleY} onCommit={(v) => patchTransform({ scaleY: v })} />
          </div>
        )}
      </FieldRow>
    </>
  );
}

// ───── Clip ─────────────────────────────────────────────────────────────────

const CLIP_HIDE: { value: ClipHide; label: string }[] = [
  { value: "inside", label: "Hide where overlapping" },
  { value: "outside", label: "Show only inside" },
  { value: "below", label: "Hide below its edge" },
  { value: "above", label: "Hide above its edge" },
  { value: "right", label: "Hide right of its edge" },
  { value: "left", label: "Hide left of its edge" },
];

function ClipSection({ template, layer, edit }: { template: Template; layer: Layer; edit: EditFn }) {
  const candidates = flattenOthers(template.layers, layer.id);
  const clipBy = layer.clipBy;
  function setClip(layerId: string | null, hide?: ClipHide) {
    edit((l) => {
      if (!layerId) {
        delete l.clipBy;
        return;
      }
      l.clipBy = { layerId, hide: hide ?? l.clipBy?.hide ?? "inside" };
    });
  }
  return (
    <>
      <FieldRow label="Clip by" hint="A layer whose box defines a reveal edge for this one">
        {(id) => (
          <Select id={id} value={clipBy?.layerId ?? ""} onChange={(e) => setClip(e.target.value || null)}>
            <option value="">None</option>
            {clipBy && !candidates.some((c) => c.id === clipBy.layerId) && <option value={clipBy.layerId}>(missing layer)</option>}
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.type})
              </option>
            ))}
          </Select>
        )}
      </FieldRow>
      {clipBy && (
        <>
          <FieldRow label="Mode" hint="How the reference layer's box masks this layer">
            {(id) => (
              <Select id={id} value={clipBy.hide} onChange={(e) => setClip(clipBy.layerId, e.target.value as ClipHide)}>
                {CLIP_HIDE.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </FieldRow>
          <Hint>Hide the reference layer (eye in Layers) to use it as an invisible marker.</Hint>
        </>
      )}
      {layer.type === "group" && (
        <MaskControls
          mask={layer.mask}
          onChange={(m) =>
            edit((l) => {
              if (l.type !== "group") return;
              if (m === null) delete l.mask;
              else l.mask = m;
            })
          }
        />
      )}
    </>
  );
}

function flattenOthers(layers: Layer[], excludeId: string): { id: string; name: string; type: Layer["type"] }[] {
  const out: { id: string; name: string; type: Layer["type"] }[] = [];
  const visit = (l: Layer) => {
    if (l.id !== excludeId) out.push({ id: l.id, name: l.name, type: l.type });
    if (l.type === "group") l.children.forEach(visit);
  };
  layers.forEach(visit);
  return out;
}

// ───── Per-corner radius editor ─────────────────────────────────────────────

function CornerRadiusEditor({ value, onChange }: { value: CornerRadius; onChange: (cr: CornerRadius) => void }) {
  // Mode is determined by the value's *type*, not equality of corner values:
  // number = linked, object = per-corner. This lets per-corner mode stay
  // active even when the user has the four corners temporarily equal.
  const linked = typeof value === "number";
  const v: { tl: number; tr: number; br: number; bl: number } = linked ? { tl: value, tr: value, br: value, bl: value } : value;
  const patch = (p: Partial<typeof v>) => onChange({ ...v, ...p });
  return (
    <>
      <FieldRow label="Corners">
        {() => (
          <SegmentedControl
            size="sm"
            aria-label="Corners"
            value={linked ? "linked" : "each"}
            options={[
              { value: "linked", label: "Linked", title: "One value applied to all four corners" },
              { value: "each", label: "Per corner", title: "Edit each corner independently" },
            ]}
            onChange={(m) => {
              if (m === "linked" && !linked) onChange(v.tl);
              if (m === "each" && linked) onChange({ tl: v.tl, tr: v.tr, br: v.br, bl: v.bl });
            }}
          />
        )}
      </FieldRow>
      {linked ? (
        <NumberRow label="Radius" value={v.tl} int suffix="px" onChange={(n) => onChange(Math.max(0, n))} />
      ) : (
        <FieldRow label="Radius" hint="Top-left, top-right, bottom-right, bottom-left">
          {(id) => (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4 }}>
              <NumberInput id={id} int min={0} size="sm" aria-label="Top-left radius" value={v.tl} onCommit={(n) => patch({ tl: n })} />
              <NumberInput int min={0} size="sm" aria-label="Top-right radius" value={v.tr} onCommit={(n) => patch({ tr: n })} />
              <NumberInput int min={0} size="sm" aria-label="Bottom-right radius" value={v.br} onCommit={(n) => patch({ br: n })} />
              <NumberInput int min={0} size="sm" aria-label="Bottom-left radius" value={v.bl} onCommit={(n) => patch({ bl: n })} />
            </div>
          )}
        </FieldRow>
      )}
    </>
  );
}

// ───── Shadow editor ────────────────────────────────────────────────────────

function ShadowEditor({ shadow, onChange }: { shadow: Shadow | undefined; onChange: (s: Shadow | null) => void }) {
  if (!shadow) {
    return (
      <FieldRow label="Shadow">
        {() => (
          <Button size="sm" variant="ghost" onClick={() => onChange({ x: 0, y: 4, blur: 8, color: "rgba(0,0,0,0.4)" })}>
            Add shadow
          </Button>
        )}
      </FieldRow>
    );
  }
  const patch = (p: Partial<Shadow>) => onChange({ ...shadow, ...p });
  return (
    <>
      <FieldRow label="Shadow">
        {(id) => (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4, flex: 1, minWidth: 0 }}>
              <NumberInput id={id} int size="sm" aria-label="Shadow X" value={shadow.x} onCommit={(v) => patch({ x: v })} />
              <NumberInput int size="sm" aria-label="Shadow Y" value={shadow.y} onCommit={(v) => patch({ y: v })} />
              <NumberInput int min={0} size="sm" aria-label="Shadow blur" value={shadow.blur} onCommit={(v) => patch({ blur: Math.max(0, v) })} />
            </div>
            <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
              Remove
            </Button>
          </div>
        )}
      </FieldRow>
      <FieldRow label="Shadow color">
        {(id) =>
          typeof shadow.color === "string" ? (
            <ColorInput id={id} label="Shadow color" value={shadow.color} onChange={(c) => patch({ color: c })} />
          ) : (
            <span style={{ fontSize: fontSize.sm, color: colors.textDim }}>From field {shadow.color.fieldKey}</span>
          )
        }
      </FieldRow>
    </>
  );
}

// ───── Field binding control ────────────────────────────────────────────────

function BindingControl({
  template,
  label,
  value,
  allowedTypes,
  literalKind = "text",
  onChange,
  onUpload,
  resolveUrl,
  onPickFromLibrary,
}: {
  template: Template;
  label: string;
  value: string | { fieldKey: string };
  allowedTypes: ("text" | "image" | "color" | "number" | "video" | "time")[];
  /** Which input control to use when the value is a literal string. */
  literalKind?: "text" | "color" | "image" | "video";
  onChange: (v: string | { fieldKey: string }) => void;
  onUpload?: UploadFn;
  resolveUrl?: (src: string) => string;
  onPickFromLibrary?: PickFromLibraryFn;
}) {
  const isBound = typeof value !== "string";
  const candidates = template.fields.filter((f) => allowedTypes.includes(f.type));
  const canBind = isBound || candidates.length > 0;
  return (
    <>
      <FieldRow label={label} hint={canBind ? undefined : "Add a field in the Template tab to bind this"}>
        {(id) => (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            {canBind && (
              <SegmentedControl
                size="sm"
                aria-label={`${label} source`}
                value={isBound ? "field" : "value"}
                options={[
                  { value: "value", label: "Value" },
                  { value: "field", label: "Field" },
                ]}
                onChange={(m) => {
                  if (m === "value" && isBound) onChange(defaultLiteral(literalKind));
                  if (m === "field" && !isBound) onChange({ fieldKey: candidates[0]?.key ?? "" });
                }}
              />
            )}
            {isBound ? (
              <Select id={id} aria-label={`${label} field`} value={value.fieldKey} onChange={(e) => onChange({ fieldKey: e.target.value })}>
                {!candidates.some((f) => f.key === value.fieldKey) && <option value={value.fieldKey}>(missing field)</option>}
                {candidates.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label} ({f.key})
                  </option>
                ))}
              </Select>
            ) : literalKind === "color" ? (
              <ColorInput id={id} label={label} value={value} onChange={(c) => onChange(c)} />
            ) : literalKind === "image" ? (
              <ImageInput
                id={id}
                value={value}
                onChange={(s) => onChange(s)}
                onUpload={onUpload}
                resolveUrl={resolveUrl}
                onPickFromLibrary={onPickFromLibrary && (() => onPickFromLibrary("image"))}
              />
            ) : literalKind === "video" ? (
              <VideoInput
                id={id}
                value={value}
                onChange={(s) => onChange(s)}
                onUpload={onUpload}
                resolveUrl={resolveUrl}
                onPickFromLibrary={onPickFromLibrary && (() => onPickFromLibrary("video"))}
              />
            ) : (
              <AutoTextarea id={id} value={value} onChange={(s) => onChange(s)} />
            )}
          </div>
        )}
      </FieldRow>
    </>
  );
}

function defaultLiteral(kind: "text" | "color" | "image" | "video"): string {
  if (kind === "color") return "#ffffff";
  return "";
}

// ───── Group mask controls ──────────────────────────────────────────────────

function MaskControls({ mask, onChange }: { mask: MaskShape | undefined; onChange: (m: MaskShape | null) => void }) {
  return (
    <>
      <FieldRow label="Mask">
        {() => (
          <SegmentedControl
            size="sm"
            aria-label="Mask"
            value={mask?.kind ?? "none"}
            options={[
              { value: "none", label: "None" },
              { value: "rect", label: "Rect" },
              { value: "ellipse", label: "Ellipse" },
            ]}
            onChange={(k) => {
              if (k === "none") onChange(null);
              else onChange({ kind: k, x: mask?.x ?? 0, y: mask?.y ?? 0, w: mask?.w ?? 400, h: mask?.h ?? 200, cornerRadius: mask?.cornerRadius ?? 0 });
            }}
          />
        )}
      </FieldRow>
      {mask && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", columnGap: 8, rowGap: 4, marginTop: 4 }}>
          <GridNumber label="X" name="Mask X" value={mask.x} onCommit={(v) => onChange({ ...mask, x: v })} />
          <GridNumber label="Y" name="Mask Y" value={mask.y} onCommit={(v) => onChange({ ...mask, y: v })} />
          <GridNumber label="W" name="Mask width" value={mask.w} onCommit={(v) => onChange({ ...mask, w: v })} />
          <GridNumber label="H" name="Mask height" value={mask.h} onCommit={(v) => onChange({ ...mask, h: v })} />
        </div>
      )}
    </>
  );
}

// ───── Layout primitives ────────────────────────────────────────────────────

/** One heading style for every inspector section (11 px / 600 uppercase, muted). */
export function Section({ title, first, children }: { title: string; first?: boolean; children: ReactNode }) {
  return (
    <section
      style={{
        minWidth: 0,
        padding: first ? "0 0 10px" : "10px 0",
        borderTop: first ? undefined : `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <h4
        style={{
          margin: "0 0 2px",
          fontSize: fontSize.xs,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: colors.textMuted,
        }}
      >
        {title}
      </h4>
      {children}
    </section>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p style={{ margin: "0 0 0 88px", fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 1.4 }}>{children}</p>;
}

/** A compact number cell for the 2-column grids: a short label (or icon) then the input. */
function GridNumber({
  label,
  name,
  value,
  onCommit,
  int,
  precision,
  min,
  max,
  suffix,
}: {
  label: ReactNode;
  /** Accessible name and tooltip. */
  name: string;
  value: number;
  onCommit: (v: number) => void;
  int?: boolean;
  precision?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const id = useId();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      <label
        htmlFor={id}
        title={name}
        style={{ width: 14, flexShrink: 0, display: "flex", justifyContent: "center", fontSize: fontSize.xs, color: colors.textDim }}
      >
        {label}
      </label>
      <div style={{ flex: 1, minWidth: 0 }}>
        <NumberInput
          id={id}
          size="sm"
          aria-label={name}
          value={Number.isFinite(value) ? value : 0}
          int={int ?? precision === undefined}
          precision={precision}
          min={min}
          max={max}
          suffix={suffix}
          onCommit={onCommit}
        />
      </div>
    </div>
  );
}

function NumberRow({
  label,
  value,
  onChange,
  step = 1,
  precision,
  int,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  precision?: number;
  int?: boolean;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <FieldRow label={label}>
      {(id) => (
        <NumberInput
          id={id}
          size="sm"
          value={Number.isFinite(value) ? value : 0}
          step={step}
          // Whole numbers unless the caller asks for decimals.
          int={int ?? (precision === undefined && Number.isInteger(step))}
          precision={precision}
          min={min}
          max={max}
          suffix={suffix}
          onCommit={onChange}
        />
      )}
    </FieldRow>
  );
}

async function copyId(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(id);
    toast({ message: "Id copied" });
  } catch {
    toast({ message: "Couldn't copy the id", tone: "error" });
  }
}

/** Enter in a single-line field ends the edit (and its undo step). */
function blurOnEnter(e: React.KeyboardEvent<HTMLInputElement>): void {
  if (e.key === "Enter") e.currentTarget.blur();
}

function findInDraft(layers: Draft<Layer>[], id: string): Draft<Layer> | null {
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.type === "group") {
      const f = findInDraft(l.children, id);
      if (f) return f;
    }
  }
  return null;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
