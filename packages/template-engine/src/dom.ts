import type {
  Layer,
  Template,
  TextStyle,
  Fill,
  Transform,
  CornerRadius,
  Shadow,
} from "@overlaysys/core";
import { resolveBinding } from "./bindings";

export type LayerNodeMap = Map<string, HTMLElement>;

/**
 * Apply a `crop` window to a video element by scaling and translating
 * the underlying frame so the visible sub-rect fills the layer box.
 * The parent's overflow:hidden is what actually clips the rest off.
 *
 * Math: if the source frame is 100% × 100% and we want to keep the
 * sub-rect (left, top) to (right, bottom) — both in 0..1 fractions —
 * we need to scale by 1/(right-left) horizontally and 1/(bottom-top)
 * vertically, then translate so the cropped area aligns to the
 * top-left corner of the layer.
 */
function applyVideoCrop(
  v: HTMLVideoElement,
  crop: { left: number; top: number; right: number; bottom: number },
): void {
  const cw = Math.max(0.001, crop.right - crop.left);
  const ch = Math.max(0.001, crop.bottom - crop.top);
  if (cw >= 0.999 && ch >= 0.999 && crop.left <= 0.001 && crop.top <= 0.001) {
    // No-op crop. Skip the transform so the layer's own GSAP transform
    // (rotate + scale + translate) is uncontested.
    return;
  }
  const sx = 1 / cw;
  const sy = 1 / ch;
  const tx = -crop.left * sx * 100;
  const ty = -crop.top * sy * 100;
  v.style.transformOrigin = "0 0";
  v.style.transform = `translate(${tx}%, ${ty}%) scale(${sx}, ${sy})`;
}

function applyTransform(el: HTMLElement, t: Transform): void {
  el.style.position = "absolute";
  el.style.left = `${t.x}px`;
  el.style.top = `${t.y}px`;
  if (t.w !== undefined) el.style.width = `${t.w}px`;
  if (t.h !== undefined) el.style.height = `${t.h}px`;
  el.style.transformOrigin = `${t.anchorX * 100}% ${t.anchorY * 100}%`;
  el.style.transform = `rotate(${t.rotation}deg) scale(${t.scaleX}, ${t.scaleY})`;
  el.style.opacity = String(t.opacity);
  el.style.willChange = "transform, opacity";
}

function applyTextStyle(el: HTMLElement, s: TextStyle, data: Record<string, string>): void {
  el.style.fontFamily = s.fontFamily;
  el.style.fontSize = `${s.fontSize}px`;
  el.style.fontWeight = String(s.fontWeight);
  el.style.color = resolveBinding(s.color, data, "#ffffff");
  el.style.letterSpacing = `${s.letterSpacing}px`;
  el.style.lineHeight = String(s.lineHeight);
  el.style.textAlign = s.align;
  el.style.whiteSpace = "pre";
}

function fillToCss(fill: Fill, data: Record<string, string>): string {
  if (fill.kind === "solid") return resolveBinding(fill.color, data, "#000000");
  const stops = fill.stops
    .map((s) => `${resolveBinding(s.color, data, "#ffffff")} ${s.at * 100}%`)
    .join(", ");
  return `linear-gradient(${fill.angle}deg, ${stops})`;
}

function cornerRadiusToCss(cr: CornerRadius): string {
  if (typeof cr === "number") return `${cr}px`;
  return `${cr.tl}px ${cr.tr}px ${cr.br}px ${cr.bl}px`;
}

/**
 * Build a CSS clip-path for non-trivial shape kinds. Returns undefined for
 * rect/ellipse — those use the layer's own box / border-radius.
 */
function shapeClipPath(
  kind: string,
  sides: number,
  starPoints: number,
  starInnerRatio: number,
): string | undefined {
  switch (kind) {
    case "triangle":
      return "polygon(50% 0%, 0% 100%, 100% 100%)";
    case "polygon": {
      const pts: string[] = [];
      const n = Math.max(3, Math.min(20, Math.round(sides)));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const x = 50 + 50 * Math.cos(a);
        const y = 50 + 50 * Math.sin(a);
        pts.push(`${x.toFixed(3)}% ${y.toFixed(3)}%`);
      }
      return `polygon(${pts.join(", ")})`;
    }
    case "star": {
      const n = Math.max(3, Math.min(20, Math.round(starPoints)));
      const total = n * 2;
      const ratio = Math.max(0.05, Math.min(0.95, starInnerRatio));
      const pts: string[] = [];
      for (let i = 0; i < total; i++) {
        const a = (i / total) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? 50 : 50 * ratio;
        const x = 50 + r * Math.cos(a);
        const y = 50 + r * Math.sin(a);
        pts.push(`${x.toFixed(3)}% ${y.toFixed(3)}%`);
      }
      return `polygon(${pts.join(", ")})`;
    }
    default:
      return undefined;
  }
}

function shadowToFilter(shadow: Shadow, data: Record<string, string>): string {
  const c = resolveBinding(shadow.color, data, "rgba(0,0,0,0.5)");
  return `drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur}px ${c})`;
}

function buildLayer(
  layer: Layer,
  data: Record<string, string>,
  nodes: LayerNodeMap,
): HTMLElement {
  let el: HTMLElement;

  switch (layer.type) {
    case "text": {
      el = document.createElement("div");
      el.dataset["layerId"] = layer.id;
      el.dataset["layerType"] = "text";
      applyTextStyle(el, layer.style, data);
      el.textContent = resolveBinding(layer.content, data);
      break;
    }
    case "image": {
      el = document.createElement("img");
      const img = el as HTMLImageElement;
      img.src = resolveBinding(layer.src, data);
      img.style.objectFit = layer.fit;
      img.style.width = "100%";
      img.style.height = "100%";
      img.dataset["layerId"] = layer.id;
      img.dataset["layerType"] = "image";
      img.draggable = false;
      break;
    }
    case "video": {
      // Wrap the video in a div so the layer's transform (applied below by
      // applyTransform) doesn't fight with the crop transform we set on the
      // <video>. The wrapper takes the layer transform; the inner video
      // takes the crop transform; the wrapper's overflow:hidden clips the
      // cropped-out parts.
      el = document.createElement("div");
      el.dataset["layerId"] = layer.id;
      el.dataset["layerType"] = "video";
      el.style.overflow = "hidden";
      el.style.width = "100%";
      el.style.height = "100%";

      const v = document.createElement("video");
      v.muted = layer.muted;
      v.loop = layer.loop;
      v.autoplay = layer.autoplay;
      v.playsInline = true;
      v.preload = "auto";
      v.controls = false;
      v.disablePictureInPicture = true;
      v.style.width = "100%";
      v.style.height = "100%";
      v.style.objectFit = layer.fit;
      v.style.pointerEvents = "none";
      applyVideoCrop(v, layer.crop);
      v.playbackRate = layer.playbackRate;
      const initialSrc = resolveBinding(layer.src, data, "");
      if (initialSrc) v.src = initialSrc;
      // trimStart drives the initial currentTime; trimEnd is enforced by
      // the timeupdate handler below.
      const trimStart = layer.trimStart || 0;
      const trimEnd = layer.trimEnd || 0;
      if (trimStart > 0) {
        v.addEventListener("loadedmetadata", () => {
          v.currentTime = trimStart;
        }, { once: true });
      }
      if (trimEnd > 0) {
        v.addEventListener("timeupdate", () => {
          if (v.currentTime >= trimEnd) {
            if (v.loop) {
              v.currentTime = trimStart;
              v.play().catch(() => {});
            } else {
              v.pause();
              v.currentTime = trimEnd;
            }
          }
        });
      }
      // Some browsers reject autoplay even when muted; retry on first
      // metadata available so the video starts as soon as the layer mounts.
      if (layer.autoplay) {
        v.addEventListener("loadeddata", () => {
          v.play().catch(() => {});
        }, { once: true });
      }
      el.appendChild(v);
      break;
    }
    case "shape": {
      el = document.createElement("div");
      el.dataset["layerId"] = layer.id;
      el.dataset["layerType"] = "shape";
      el.style.background = fillToCss(layer.fill, data);
      el.style.width = "100%";
      el.style.height = "100%";

      if (layer.shape === "ellipse") {
        el.style.borderRadius = "50%";
      } else if (layer.shape === "rect") {
        el.style.borderRadius = cornerRadiusToCss(layer.cornerRadius);
      } else {
        // triangle / polygon / star — use clip-path on the same box.
        const cp = shapeClipPath(
          layer.shape,
          layer.sides,
          layer.starPoints,
          layer.starInnerRatio,
        );
        if (cp) el.style.clipPath = cp;
      }

      // Edge effects: blur + drop-shadow combined into a single filter.
      // drop-shadow follows the clip-path/border-radius (unlike box-shadow),
      // so non-rect shapes get correct shadows.
      const filters: string[] = [];
      if (layer.blur > 0) filters.push(`blur(${layer.blur}px)`);
      if (layer.shadow) filters.push(shadowToFilter(layer.shadow, data));
      if (filters.length > 0) el.style.filter = filters.join(" ");
      break;
    }
    case "group": {
      el = document.createElement("div");
      el.dataset["layerId"] = layer.id;
      el.dataset["layerType"] = "group";
      if (layer.mask) {
        const m = layer.mask;
        if (m.kind === "rect") {
          el.style.clipPath = `polygon(${m.x}px ${m.y}px, ${m.x + m.w}px ${m.y}px, ${m.x + m.w}px ${m.y + m.h}px, ${m.x}px ${m.y + m.h}px)`;
        } else {
          const cx = m.x + m.w / 2;
          const cy = m.y + m.h / 2;
          el.style.clipPath = `ellipse(${m.w / 2}px ${m.h / 2}px at ${cx}px ${cy}px)`;
        }
      }
      for (const child of layer.children) {
        el.appendChild(buildLayer(child, data, nodes));
      }
      break;
    }
  }

  applyTransform(el, layer.transform);
  if (!layer.visible) el.style.display = "none";
  nodes.set(layer.id, el);
  return el;
}

export function buildTemplateDom(
  template: Template,
  data: Record<string, string>,
): { root: HTMLElement; nodes: LayerNodeMap } {
  const root = document.createElement("div");
  root.dataset["templateId"] = template.id;
  root.style.position = "relative";
  root.style.width = `${template.size.w}px`;
  root.style.height = `${template.size.h}px`;
  // Clip at the stage boundary so what authors see in the editor matches
  // what the audience sees in the renderer.
  root.style.overflow = "hidden";
  root.style.pointerEvents = "none";

  const nodes: LayerNodeMap = new Map();
  for (const layer of template.layers) {
    root.appendChild(buildLayer(layer, data, nodes));
  }
  return { root, nodes };
}

/**
 * Hot-update bound properties when the operator pushes new field values.
 * Walks every layer and re-applies any property whose value is a binding
 * (text content, image src, colors, gradient stops). Unbound properties
 * stay where they are.
 */
export function updateTemplateData(
  template: Template,
  data: Record<string, string>,
  nodes: LayerNodeMap,
): void {
  function walk(layer: Layer): void {
    const el = nodes.get(layer.id);
    if (!el) return;
    if (layer.type === "text") {
      if (typeof layer.content !== "string") {
        el.textContent = resolveBinding(layer.content, data);
      }
      // Always re-apply color in case it's bound — cheap; idempotent if literal.
      el.style.color = resolveBinding(layer.style.color, data, "#ffffff");
    } else if (layer.type === "image") {
      if (typeof layer.src !== "string") {
        (el as HTMLImageElement).src = resolveBinding(layer.src, data);
      }
    } else if (layer.type === "video") {
      // The wrapper div holds the video as its first child.
      const v = el.firstElementChild as HTMLVideoElement | null;
      if (v && typeof layer.src !== "string") {
        const next = resolveBinding(layer.src, data, "");
        if (next && next !== v.src) {
          v.src = next;
          // Reset trim-start when source changes.
          v.currentTime = layer.trimStart || 0;
          if (layer.autoplay) v.play().catch(() => {});
        }
      }
    } else if (layer.type === "shape") {
      el.style.background = fillToCss(layer.fill, data);
      // Re-apply filter (shadow color may be bound).
      const filters: string[] = [];
      if (layer.blur > 0) filters.push(`blur(${layer.blur}px)`);
      if (layer.shadow) filters.push(shadowToFilter(layer.shadow, data));
      el.style.filter = filters.length > 0 ? filters.join(" ") : "";
    } else if (layer.type === "group") {
      for (const child of layer.children) walk(child);
    }
  }
  for (const layer of template.layers) walk(layer);
}
