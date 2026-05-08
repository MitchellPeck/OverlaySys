import type { Draft } from "immer";
import type { Layer, Template, Transform, MaskShape, ColorValue, CornerRadius, Shadow } from "@overlaysys/core";
import { findLayer } from "./utils";
import { ColorInput } from "./ColorInput";
import { FontInput } from "./FontInput";
import { ImageInput } from "./ImageInput";
import { VideoInput } from "./VideoInput";
import { GradientStops } from "./GradientStops";

type CommitFn = (recipe: (d: Draft<Template>) => void) => void;
type PushHistoryFn = () => void;

type Props = {
  template: Template;
  selectedId: string | null;
  onCommit: CommitFn;
  onPushHistory?: PushHistoryFn;
};

export function PropertyInspector({ template, selectedId, onCommit, onPushHistory }: Props) {
  if (!selectedId) {
    return (
      <p style={{ color: "var(--text-dim, #9099a8)", fontSize: 12, padding: 8 }}>
        Select a layer to inspect.
      </p>
    );
  }
  const layer = findLayer(template.layers, selectedId);
  if (!layer) return null;

  const patchTransform = (patch: Partial<Transform>) =>
    onCommit((d) => {
      const l = findInDraft(d.layers, selectedId);
      if (!l) return;
      Object.assign(l.transform, patch);
    });

  const patchLayer = (patch: Partial<Layer>) =>
    onCommit((d) => {
      const l = findInDraft(d.layers, selectedId);
      if (!l) return;
      Object.assign(l, patch);
    });

  return (
    <div style={{ padding: "0 4px" }}>
      <Section title="Identity">
        <Row label="ID">
          <code style={{ fontSize: 11, color: "var(--text-dim, #9099a8)" }}>{layer.id}</code>
        </Row>
        <Row label="Name">
          <input value={layer.name} onChange={(e) => patchLayer({ name: e.target.value } as Partial<Layer>)} style={inputStyle} />
        </Row>
        <Row label="Visible">
          <input
            type="checkbox"
            checked={layer.visible}
            onChange={(e) => patchLayer({ visible: e.target.checked } as Partial<Layer>)}
          />
        </Row>
      </Section>

      <Section title="Transform">
        <NumberRow label="X" value={layer.transform.x} onChange={(v) => patchTransform({ x: v })} />
        <NumberRow label="Y" value={layer.transform.y} onChange={(v) => patchTransform({ y: v })} />
        <NumberRow label="Width" value={layer.transform.w ?? 0} onChange={(v) => patchTransform({ w: v })} />
        <NumberRow label="Height" value={layer.transform.h ?? 0} onChange={(v) => patchTransform({ h: v })} />
        <NumberRow label="Rotation°" value={layer.transform.rotation} onChange={(v) => patchTransform({ rotation: v })} />
        <NumberRow label="Opacity" value={layer.transform.opacity} step={0.05} onChange={(v) => patchTransform({ opacity: clamp01(v) })} />
        <NumberRow label="Scale X" value={layer.transform.scaleX} step={0.05} onChange={(v) => patchTransform({ scaleX: v })} />
        <NumberRow label="Scale Y" value={layer.transform.scaleY} step={0.05} onChange={(v) => patchTransform({ scaleY: v })} />
      </Section>

      {layer.type === "text" && (
        <Section title="Text">
          <Row label="Family">
            <FontInput
              value={layer.style.fontFamily}
              templateFonts={template.fonts}
              onChange={(family) =>
                patchLayer({ style: { ...layer.style, fontFamily: family } } as Partial<Layer>)
              }
              onAddFont={(entry) =>
                onCommit((d) => {
                  d.fonts.push(entry);
                })
              }
            />
          </Row>
          <BindingControl
            template={template}
            value={layer.content}
            allowedTypes={["text"]}
            onChange={(v) => patchLayer({ content: v } as Partial<Layer>)}
          />
          <NumberRow
            label="Font size"
            value={layer.style.fontSize}
            onChange={(v) =>
              patchLayer({ style: { ...layer.style, fontSize: v } } as Partial<Layer>)
            }
          />
          <Row label="Weight">
            <input
              value={String(layer.style.fontWeight)}
              onChange={(e) =>
                patchLayer({ style: { ...layer.style, fontWeight: e.target.value } } as Partial<Layer>)
              }
              style={inputStyle}
            />
          </Row>
          <BindingControl
            template={template}
            label="Color"
            value={layer.style.color}
            allowedTypes={["color"]}
            literalKind="color"
            onChange={(v) =>
              patchLayer({ style: { ...layer.style, color: v as ColorValue } } as Partial<Layer>)
            }
          />
          <Row label="Align">
            <select
              value={layer.style.align}
              onChange={(e) =>
                patchLayer({
                  style: { ...layer.style, align: e.target.value as "left" | "center" | "right" },
                } as Partial<Layer>)
              }
              style={inputStyle}
            >
              <option value="left">left</option>
              <option value="center">center</option>
              <option value="right">right</option>
            </select>
          </Row>
        </Section>
      )}

      {layer.type === "shape" && (
        <Section title="Shape">
          <Row label="Kind">
            <select
              value={layer.shape}
              onChange={(e) =>
                patchLayer({ shape: e.target.value as "rect" | "ellipse" | "triangle" | "polygon" | "star" } as Partial<Layer>)
              }
              style={inputStyle}
            >
              <option value="rect">rect</option>
              <option value="ellipse">ellipse</option>
              <option value="triangle">triangle</option>
              <option value="polygon">polygon</option>
              <option value="star">star</option>
            </select>
          </Row>
          {layer.shape === "polygon" && (
            <NumberRow
              label="Sides"
              value={layer.sides}
              step={1}
              onChange={(v) =>
                patchLayer({ sides: Math.max(3, Math.min(20, Math.round(v))) } as Partial<Layer>)
              }
            />
          )}
          {layer.shape === "star" && (
            <>
              <NumberRow
                label="Points"
                value={layer.starPoints}
                step={1}
                onChange={(v) =>
                  patchLayer({ starPoints: Math.max(3, Math.min(20, Math.round(v))) } as Partial<Layer>)
                }
              />
              <NumberRow
                label="Inner ratio"
                value={layer.starInnerRatio}
                step={0.05}
                onChange={(v) =>
                  patchLayer({ starInnerRatio: Math.max(0.05, Math.min(0.95, v)) } as Partial<Layer>)
                }
              />
            </>
          )}
          <Row label="Fill kind">
            <select
              value={layer.fill.kind}
              onChange={(e) => {
                const kind = e.target.value as "solid" | "linear-gradient";
                if (kind === "solid")
                  patchLayer({ fill: { kind: "solid", color: "#ff3a3a" } } as Partial<Layer>);
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
              style={inputStyle}
            >
              <option value="solid">solid</option>
              <option value="linear-gradient">linear-gradient</option>
            </select>
          </Row>
          {layer.fill.kind === "solid" && (
            <BindingControl
              template={template}
              label="Color"
              value={layer.fill.color}
              allowedTypes={["color"]}
              literalKind="color"
              onChange={(v) =>
                patchLayer({ fill: { kind: "solid", color: v as ColorValue } } as Partial<Layer>)
              }
            />
          )}
          {layer.fill.kind === "linear-gradient" && (
            <>
              <NumberRow
                label="Angle°"
                value={layer.fill.angle}
                onChange={(v) =>
                  patchLayer({
                    fill: { ...layer.fill, kind: "linear-gradient", angle: v },
                  } as Partial<Layer>)
                }
              />
              <div style={{ marginTop: 6 }}>
                <GradientStops
                  stops={layer.fill.stops}
                  fields={template.fields}
                  onChange={(stops) =>
                    onCommit((d) => {
                      const l = findInDraft(d.layers, selectedId);
                      if (!l || l.type !== "shape") return;
                      if (l.fill.kind !== "linear-gradient") return;
                      l.fill.stops = stops;
                    })
                  }
                  onPushHistory={onPushHistory}
                />
              </div>
            </>
          )}
          {layer.shape === "rect" && (
            <CornerRadiusEditor
              value={layer.cornerRadius}
              onChange={(cr) => patchLayer({ cornerRadius: cr } as Partial<Layer>)}
            />
          )}

          <NumberRow
            label="Blur"
            value={layer.blur ?? 0}
            step={1}
            onChange={(v) => patchLayer({ blur: Math.max(0, v) } as Partial<Layer>)}
          />
          <ShadowEditor
            shadow={layer.shadow}
            onChange={(s) => patchLayer({ shadow: s ?? undefined } as Partial<Layer>)}
          />
        </Section>
      )}

      {layer.type === "image" && (
        <Section title="Image">
          <BindingControl
            template={template}
            value={layer.src}
            allowedTypes={["image"]}
            literalKind="image"
            onChange={(v) => patchLayer({ src: v } as Partial<Layer>)}
          />
          <Row label="Fit">
            <select
              value={layer.fit}
              onChange={(e) => patchLayer({ fit: e.target.value as "contain" | "cover" | "fill" } as Partial<Layer>)}
              style={inputStyle}
            >
              <option value="cover">cover</option>
              <option value="contain">contain</option>
              <option value="fill">fill</option>
            </select>
          </Row>
        </Section>
      )}

      {layer.type === "video" && (
        <Section title="Video">
          <BindingControl
            template={template}
            value={layer.src}
            allowedTypes={["video"]}
            literalKind="video"
            onChange={(v) => patchLayer({ src: v } as Partial<Layer>)}
          />
          <Row label="Fit">
            <select
              value={layer.fit}
              onChange={(e) =>
                patchLayer({ fit: e.target.value as "contain" | "cover" | "fill" } as Partial<Layer>)
              }
              style={inputStyle}
            >
              <option value="cover">cover</option>
              <option value="contain">contain</option>
              <option value="fill">fill</option>
            </select>
          </Row>
          <Row label="">
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-dim, #9099a8)", marginRight: 8 }}>
              <input
                type="checkbox"
                checked={layer.loop}
                onChange={(e) => patchLayer({ loop: e.target.checked } as Partial<Layer>)}
              />
              loop
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-dim, #9099a8)", marginRight: 8 }}>
              <input
                type="checkbox"
                checked={layer.autoplay}
                onChange={(e) => patchLayer({ autoplay: e.target.checked } as Partial<Layer>)}
              />
              autoplay
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-dim, #9099a8)", marginRight: 8 }}>
              <input
                type="checkbox"
                checked={layer.muted}
                onChange={(e) => patchLayer({ muted: e.target.checked } as Partial<Layer>)}
              />
              muted
            </label>
          </Row>
          <Row label="Speed">
            <input
              type="number"
              min={0.25}
              max={4}
              step={0.05}
              value={layer.playbackRate}
              onChange={(e) =>
                patchLayer({ playbackRate: Number(e.target.value) || 1 } as Partial<Layer>)
              }
              style={inputStyle}
            />
          </Row>
          <Row label="Trim (s)">
            <div style={{ display: "flex", gap: 4 }}>
              <input
                type="number"
                min={0}
                step={0.05}
                placeholder="start"
                value={layer.trimStart}
                onChange={(e) =>
                  patchLayer({ trimStart: Math.max(0, Number(e.target.value) || 0) } as Partial<Layer>)
                }
                style={inputStyle}
              />
              <input
                type="number"
                min={0}
                step={0.05}
                placeholder="end (0 = full)"
                value={layer.trimEnd}
                onChange={(e) =>
                  patchLayer({ trimEnd: Math.max(0, Number(e.target.value) || 0) } as Partial<Layer>)
                }
                style={inputStyle}
              />
            </div>
          </Row>
          <Row label="Crop">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
              {(["left", "top", "right", "bottom"] as const).map((side) => (
                <input
                  key={side}
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  title={`${side} (0..1)`}
                  value={layer.crop[side]}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(1, Number(e.target.value) || 0));
                    patchLayer({
                      crop: { ...layer.crop, [side]: v },
                    } as Partial<Layer>);
                  }}
                  style={inputStyle}
                />
              ))}
            </div>
          </Row>
        </Section>
      )}

      {layer.type === "group" && (
        <Section title="Group">
          <Row label="Children">
            <span style={{ fontSize: 11, color: "var(--text-dim, #9099a8)" }}>{layer.children.length}</span>
          </Row>
          <MaskControls
            mask={layer.mask}
            onChange={(m) => {
              if (m === null) {
                onCommit((d) => {
                  const l = findInDraft(d.layers, selectedId);
                  if (l && l.type === "group") {
                    delete l.mask;
                  }
                });
              } else {
                onCommit((d) => {
                  const l = findInDraft(d.layers, selectedId);
                  if (l && l.type === "group") l.mask = m;
                });
              }
            }}
          />
        </Section>
      )}
    </div>
  );
}

// ───── Per-corner radius editor ─────────────────────────────────────────────

function CornerRadiusEditor({
  value,
  onChange,
}: {
  value: CornerRadius;
  onChange: (cr: CornerRadius) => void;
}) {
  // Mode is determined by the value's *type*, not equality of corner values:
  // number = linked, object = per-corner. This lets per-corner mode stay
  // active even when the user has the four corners temporarily equal.
  const linked = typeof value === "number";
  const v: { tl: number; tr: number; br: number; bl: number } = linked
    ? { tl: value, tr: value, br: value, bl: value }
    : value;

  function patch(p: Partial<typeof v>): void {
    onChange({ ...v, ...p });
  }

  function switchToLinked(): void {
    // Collapse to a single number using TL as the canonical value.
    onChange(v.tl);
  }
  function switchToPerCorner(): void {
    // Spread the current uniform value across all four corners.
    onChange({ tl: v.tl, tr: v.tr, br: v.br, bl: v.bl });
  }

  return (
    <>
      <Row label="Corners">
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={switchToLinked}
            disabled={linked}
            style={tabBtn(linked)}
            title="One value applied to all four corners"
          >
            Linked
          </button>
          <button
            onClick={switchToPerCorner}
            disabled={!linked}
            style={tabBtn(!linked)}
            title="Edit each corner independently"
          >
            Per corner
          </button>
        </div>
      </Row>
      {linked ? (
        <NumberRow
          label="Radius"
          value={v.tl}
          step={1}
          onChange={(n) => onChange(Math.max(0, n))}
        />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr", gap: 6, alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: "var(--text-dim, #9099a8)" }}>TL / TR</span>
            <input type="number" value={v.tl} step={1} onChange={(e) => patch({ tl: Math.max(0, parseFloat(e.target.value) || 0) })} style={smallInput} />
            <input type="number" value={v.tr} step={1} onChange={(e) => patch({ tr: Math.max(0, parseFloat(e.target.value) || 0) })} style={smallInput} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr", gap: 6, alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: "var(--text-dim, #9099a8)" }}>BL / BR</span>
            <input type="number" value={v.bl} step={1} onChange={(e) => patch({ bl: Math.max(0, parseFloat(e.target.value) || 0) })} style={smallInput} />
            <input type="number" value={v.br} step={1} onChange={(e) => patch({ br: Math.max(0, parseFloat(e.target.value) || 0) })} style={smallInput} />
          </div>
        </>
      )}
    </>
  );
}

// ───── Shadow editor ────────────────────────────────────────────────────────

function ShadowEditor({
  shadow,
  onChange,
}: {
  shadow: Shadow | undefined;
  onChange: (s: Shadow | null) => void;
}) {
  if (!shadow) {
    return (
      <Row label="Shadow">
        <button
          onClick={() => onChange({ x: 0, y: 4, blur: 8, color: "rgba(0,0,0,0.4)" })}
          style={addRowBtn}
        >
          + Add drop shadow
        </button>
      </Row>
    );
  }
  function patch(p: Partial<Shadow>): void {
    onChange({ ...shadow!, ...p });
  }
  const colorValue = typeof shadow.color === "string" ? shadow.color : "rgba(0,0,0,0.5)";
  return (
    <>
      <Row label="Shadow">
        <button onClick={() => onChange(null)} style={removeBtn}>Remove</button>
      </Row>
      <NumberRow label="X" value={shadow.x} step={1} onChange={(v) => patch({ x: v })} />
      <NumberRow label="Y" value={shadow.y} step={1} onChange={(v) => patch({ y: v })} />
      <NumberRow label="Blur" value={shadow.blur} step={1} onChange={(v) => patch({ blur: Math.max(0, v) })} />
      <Row label="Color">
        {typeof shadow.color === "string" ? (
          <ColorInput value={colorValue} onChange={(c) => patch({ color: c })} />
        ) : (
          <code style={{ fontSize: 11, color: "var(--accent-2, #ffb13a)" }}>
            ${shadow.color.fieldKey}
          </code>
        )}
      </Row>
    </>
  );
}

// ───── Field binding control ────────────────────────────────────────────────

function BindingControl({
  template,
  label = "Source",
  value,
  allowedTypes,
  literalKind = "text",
  onChange,
}: {
  template: Template;
  label?: string;
  value: string | { fieldKey: string };
  allowedTypes: ("text" | "image" | "color" | "number" | "video")[];
  /** Which input control to use when the value is a literal string. */
  literalKind?: "text" | "color" | "image" | "video";
  onChange: (v: string | { fieldKey: string }) => void;
}) {
  const isBound = typeof value !== "string";
  const candidates = template.fields.filter((f) => allowedTypes.includes(f.type));

  return (
    <>
      <Row label={label}>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => onChange(isBound ? defaultLiteral(literalKind) : value)}
            disabled={!isBound}
            style={tabBtn(!isBound)}
          >
            Literal
          </button>
          <button
            onClick={() => {
              if (isBound) return;
              const first = candidates[0];
              onChange({ fieldKey: first?.key ?? "" });
            }}
            disabled={isBound || candidates.length === 0}
            style={tabBtn(isBound)}
            title={candidates.length === 0 ? "Declare a field first in the Fields panel" : ""}
          >
            Bound
          </button>
        </div>
      </Row>
      {isBound ? (
        <Row label="Field">
          <select
            value={value.fieldKey}
            onChange={(e) => onChange({ fieldKey: e.target.value })}
            style={inputStyle}
          >
            {candidates.length === 0 && <option value="">(no compatible fields)</option>}
            {candidates.map((f) => (
              <option key={f.key} value={f.key}>
                ${f.key} — {f.label}
              </option>
            ))}
          </select>
        </Row>
      ) : (
        <Row label="Value">
          {literalKind === "color" ? (
            <ColorInput value={value} onChange={(c) => onChange(c)} />
          ) : literalKind === "image" ? (
            <ImageInput value={value} onChange={(s) => onChange(s)} />
          ) : literalKind === "video" ? (
            <VideoInput value={value} onChange={(s) => onChange(s)} />
          ) : (
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              style={inputStyle}
            />
          )}
        </Row>
      )}
    </>
  );
}

function defaultLiteral(kind: "text" | "color" | "image" | "video"): string {
  if (kind === "color") return "#ffffff";
  return "";
}

function tabBtn(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "4px 8px",
    background: active ? "var(--accent, #ff3a3a)" : "var(--panel-2, #1c1f25)",
    color: active ? "#fff" : "var(--text, #e9eaee)",
    border: "1px solid var(--border, #2a2e36)",
    borderRadius: 3,
    fontSize: 11,
    cursor: "pointer",
  };
}

// ───── Group mask controls ──────────────────────────────────────────────────

function MaskControls({
  mask,
  onChange,
}: {
  mask: MaskShape | undefined;
  onChange: (m: MaskShape | null) => void;
}) {
  return (
    <>
      <Row label="Mask">
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => onChange(null)} disabled={!mask} style={tabBtn(!mask)}>
            None
          </button>
          <button
            onClick={() =>
              onChange({ kind: "rect", x: 0, y: 0, w: 400, h: 200, cornerRadius: 0 })
            }
            disabled={mask?.kind === "rect"}
            style={tabBtn(mask?.kind === "rect")}
          >
            Rect
          </button>
          <button
            onClick={() => onChange({ kind: "ellipse", x: 0, y: 0, w: 400, h: 200, cornerRadius: 0 })}
            disabled={mask?.kind === "ellipse"}
            style={tabBtn(mask?.kind === "ellipse")}
          >
            Ellipse
          </button>
        </div>
      </Row>
      {mask && (
        <>
          <NumberRow label="Mask X" value={mask.x} onChange={(v) => onChange({ ...mask, x: v })} />
          <NumberRow label="Mask Y" value={mask.y} onChange={(v) => onChange({ ...mask, y: v })} />
          <NumberRow label="Mask W" value={mask.w} onChange={(v) => onChange({ ...mask, w: v })} />
          <NumberRow label="Mask H" value={mask.h} onChange={(v) => onChange({ ...mask, h: v })} />
        </>
      )}
    </>
  );
}

// ───── Layout primitives ────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h4
        style={{
          margin: 0,
          marginBottom: 6,
          fontSize: 10,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: "var(--text-dim, #9099a8)",
        }}
      >
        {title}
      </h4>
      <div>{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 8, alignItems: "center", marginBottom: 6 }}>
      <label style={{ fontSize: 12, color: "var(--text-dim, #9099a8)" }}>{label}</label>
      <div>{children}</div>
    </div>
  );
}

function NumberRow({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <Row label={label}>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        style={inputStyle}
      />
    </Row>
  );
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "4px 8px",
  background: "var(--panel-2, #1c1f25)",
  border: "1px solid var(--border, #2a2e36)",
  borderRadius: 3,
  color: "var(--text, #e9eaee)",
  fontSize: 12,
  outline: "none",
};

const smallInput: React.CSSProperties = {
  ...inputStyle,
  padding: "2px 6px",
};

const addRowBtn: React.CSSProperties = {
  padding: "4px 10px",
  background: "var(--panel-2, #1c1f25)",
  border: "1px dashed var(--border, #2a2e36)",
  borderRadius: 3,
  color: "var(--text, #e9eaee)",
  fontSize: 11,
  cursor: "pointer",
  width: "100%",
};

const removeBtn: React.CSSProperties = {
  padding: "2px 8px",
  background: "transparent",
  border: "1px solid var(--red, #f87171)",
  color: "var(--red, #f87171)",
  borderRadius: 3,
  fontSize: 11,
  cursor: "pointer",
};
