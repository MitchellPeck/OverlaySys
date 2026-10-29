"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, MoreHorizontal } from "lucide-react";
import { DEFAULT_STAGE_FOLLOWS, STAGE_RULE_KINDS } from "@overlaysys/core";
import type { ChannelConfig, ChannelRenderMode, ProjectChannelOverride, StageLayoutMeta, StageRuleKind } from "@overlaysys/core";
import { Button, Checkbox, IconButton, Input, Panel, Pill, Select, colors, fontSize, radius, useContextMenu } from "@overlaysys/ui";
import { layoutPickerModel } from "@/lib/stageLayoutPicker";
import { isCloudMode } from "@/lib/mode";
import { LanStageLinks } from "./LanStageLinks";
import { setLayoutRule } from "./channelDraft";

const RULE_LABEL: Record<StageRuleKind, string> = {
  song: "Song",
  scripture: "Scripture",
  slides: "Slides",
  graphic: "Graphic",
  video: "Video",
};

const BG_PRESETS: { label: string; value: string }[] = [
  { label: "Transparent", value: "transparent" },
  { label: "Black", value: "#000000" },
  { label: "Chroma green", value: "#00ff00" },
  { label: "Chroma blue", value: "#0000ff" },
];

const labelStyle = { fontSize: fontSize.xs, color: colors.textDim, marginBottom: 2, whiteSpace: "nowrap" } as const;

function Cell({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
}

export type ChannelCardProps = {
  config: ChannelConfig;
  dirty: boolean;
  allChannels: ChannelConfig[];
  stageLayouts: StageLayoutMeta[];
  rendererBase: string;
  onChange: (c: ChannelConfig) => void;
  onDelete: () => void;
  showOverride: boolean;
  currentProjectId: string;
  currentProjectName: string;
  override: ProjectChannelOverride | undefined;
  onSaveOverride: (o: ProjectChannelOverride) => Promise<void>;
  onClearOverride: () => Promise<void>;
};

export function ChannelCard(p: ChannelCardProps) {
  const { config, allChannels } = p;
  const [rulesOpen, setRulesOpen] = useState(!!config.layoutRules && Object.keys(config.layoutRules).length > 0);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const { open: openMenu, menu } = useContextMenu();
  const isStage = config.kind === "stage";
  const layoutModel = layoutPickerModel(p.stageLayouts, config.layoutId);
  const mirrorOptions = allChannels.filter((o) => o.id !== config.id);
  const followOptions = mirrorOptions.filter((o) => o.kind !== "stage");
  const followsValue = config.follows ?? DEFAULT_STAGE_FOLLOWS;
  const patch = (x: Partial<ChannelConfig>) => p.onChange({ ...config, ...x });
  const name = config.name || "channel";

  return (
    <li style={{ listStyle: "none" }}>
      <Panel padding="md">
        <div style={{ display: "grid", gridTemplateColumns: "minmax(110px,1.1fr) auto minmax(0,1fr) minmax(0,1fr) auto", gap: 10, alignItems: "end" }}>
          <Cell
            label={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Name
                {p.dirty && (
                  <span role="img" aria-label={`Unsaved changes to ${name}`} title="Unsaved changes" style={{ width: 8, height: 8, borderRadius: 999, background: colors.warn }} />
                )}
              </span>
            }
          >
            <Input value={config.name} onChange={(e) => patch({ name: e.target.value })} aria-label={`Name of ${name}`} />
          </Cell>
          <Cell label="Kind">
            <div style={{ height: 24, display: "flex", alignItems: "center" }}>
              <Pill tone="dim" style={{ whiteSpace: "nowrap" }}>{isStage ? "Stage monitor" : "Graphics output"}</Pill>
            </div>
          </Cell>
          {isStage ? (
            <>
              <Cell label="Shows content from">
                <Select value={followsValue} onChange={(e) => patch({ follows: e.target.value })} aria-label={`Content shown by ${name}`}>
                  {!followOptions.some((o) => o.id === followsValue) && <option value={followsValue}>{followsValue} (missing)</option>}
                  {followOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Cell>
              <Cell
                label={
                  <span style={{ display: "inline-flex", gap: 8 }}>
                    Default layout
                    {!isCloudMode() && !layoutModel.missingId && (
                      <Link href={`/design/stage/edit?id=${encodeURIComponent(layoutModel.value)}`} style={{ color: colors.accent }}>
                        Edit
                      </Link>
                    )}
                  </span>
                }
              >
                <Select
                  value={layoutModel.value}
                  onChange={(e) => patch({ layoutId: e.target.value })}
                  aria-label={`Default layout of ${name}`}
                  title={layoutModel.missingId ? "This layout no longer exists; the channel falls back to Speaker" : undefined}
                >
                  {layoutModel.options.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </Cell>
            </>
          ) : (
            <>
              <Cell label="Render mode">
                <Select value={config.renderMode} onChange={(e) => patch({ renderMode: e.target.value as ChannelRenderMode })} aria-label={`Render mode of ${name}`}>
                  <option value="normal">Normal</option>
                  <option value="matte">Matte (white on black)</option>
                </Select>
              </Cell>
              <Cell label="Mirror">
                <Select value={config.mirrorOf ?? ""} onChange={(e) => patch({ mirrorOf: e.target.value || undefined })} aria-label={`Mirror of ${name}`}>
                  <option value="">No mirror</option>
                  {mirrorOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      Mirrors {o.name}
                    </option>
                  ))}
                </Select>
              </Cell>
            </>
          )}
          <IconButton
            aria-label={`More actions for ${name}`}
            title="More actions"
            onClick={(e) =>
              openMenu(e, [
                { id: "devices", label: "Open on another device", onSelect: () => setDevicesOpen((v) => !v) },
                {
                  id: "open",
                  label: "Open renderer in new tab",
                  onSelect: () => window.open(`${p.rendererBase}/?channel=${encodeURIComponent(config.id)}`, "_blank", "noopener"),
                },
                { id: "copy", label: "Copy id", onSelect: () => void navigator.clipboard?.writeText(config.id) },
                { separator: true },
                { id: "delete", label: "Delete", danger: true, onSelect: p.onDelete },
              ])
            }
          >
            <MoreHorizontal size={16} aria-hidden />
          </IconButton>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
          {isStage ? (
            <Button size="sm" variant="ghost" aria-expanded={rulesOpen} onClick={() => setRulesOpen((v) => !v)}>
              {rulesOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />} Layout by item type
            </Button>
          ) : (
            <Button size="sm" variant="ghost" aria-expanded={bgOpen} onClick={() => setBgOpen((v) => !v)}>
              {bgOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />} Background
            </Button>
          )}
          {config.kind === "graphics" && config.renderMode === "matte" && (
            <span style={{ fontSize: fontSize.xs, color: colors.textDim }}>Matte mode forces a black background</span>
          )}
          {p.override && <span style={{ fontSize: fontSize.xs, color: colors.accent }}>Overridden in {p.currentProjectName}</span>}
        </div>

        {isStage && rulesOpen && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: fontSize.xs, color: colors.textDim, marginBottom: 6 }}>
              A rundown item can override this in its Stage screens section; Live can switch it until the next item.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
              {STAGE_RULE_KINDS.map((k) => {
                const cur = config.layoutRules?.[k];
                const known = !cur || layoutModel.options.some((o) => o.id === cur);
                return (
                  <Cell key={k} label={RULE_LABEL[k]}>
                    <Select
                      value={cur ?? ""}
                      aria-label={`${RULE_LABEL[k]} layout of ${name}`}
                      onChange={(e) => p.onChange(setLayoutRule(config, k, e.target.value || null))}
                    >
                      <option value="">Use default</option>
                      {!known && <option value={cur}>{cur} (missing)</option>}
                      {layoutModel.options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </Cell>
                );
              })}
            </div>
          </div>
        )}

        {!isStage && bgOpen && (
          <div style={{ marginTop: 8 }}>
            <BackgroundEditor value={config.background} onChange={(v) => patch({ background: v })} />
          </div>
        )}

        {devicesOpen && <LanStageLinks channelId={config.id} rendererBase={p.rendererBase} />}

        {p.showOverride && config.kind === "graphics" && (
          <ProjectOverrideEditor
            config={config}
            allChannels={allChannels}
            currentProjectId={p.currentProjectId}
            currentProjectName={p.currentProjectName}
            override={p.override}
            onSaveOverride={p.onSaveOverride}
            onClearOverride={p.onClearOverride}
          />
        )}
      </Panel>
      {menu}
    </li>
  );
}

export function BackgroundEditor({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  // Older fixtures and external write paths could omit `background`.
  const v = value ?? "transparent";
  const isPreset = BG_PRESETS.some((p) => p.value === v);
  const hex = v.startsWith("#") && v.length === 7 ? v : "#ffffff";

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: radius.sm,
          border: `1px solid ${colors.border}`,
          background:
            v === "transparent"
              ? "linear-gradient(45deg, var(--surface-2) 25%, transparent 25%, transparent 75%, var(--surface-2) 75%) 0 0 / 8px 8px, var(--bg)"
              : v,
        }}
        title={v}
      />
      <Select
        value={isPreset ? v : "__custom__"}
        aria-label="Background colour"
        onChange={(e) => {
          const sel = e.target.value;
          if (sel === "__custom__") onChange(isPreset ? "#ffffff" : v);
          else onChange(sel);
        }}
        style={{ width: 160 }}
      >
        {BG_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
        <option value="__custom__">Custom…</option>
      </Select>
      {!isPreset && (
        <input
          type="color"
          aria-label="Pick a background colour"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 32, height: 26, padding: 0, border: `1px solid ${colors.border}`, borderRadius: radius.sm }}
        />
      )}
      {!isPreset && (
        <Input
          value={v}
          aria-label="Background colour value"
          onChange={(e) => onChange(e.target.value)}
          style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, flex: 1 }}
        />
      )}
    </div>
  );
}

/**
 * Per-channel override editor scoped to the current project. Lets the
 * operator patch renderMode, mirrorOf, and background for one channel
 * without forking the org default. "Reset" soft-deletes the override row so
 * the channel falls back to the org config. Name is intentionally not
 * overridable.
 */
function ProjectOverrideEditor({
  config,
  allChannels,
  currentProjectId,
  currentProjectName,
  override,
  onSaveOverride,
  onClearOverride,
}: {
  config: ChannelConfig;
  allChannels: ChannelConfig[];
  currentProjectId: string;
  currentProjectName: string;
  override: ProjectChannelOverride | undefined;
  onSaveOverride: (o: ProjectChannelOverride) => Promise<void>;
  onClearOverride: () => Promise<void>;
}) {
  const blank = { projectId: currentProjectId, channelId: config.id };
  const [open, setOpen] = useState<boolean>(!!override);
  const [draft, setDraft] = useState<ProjectChannelOverride>(() => override ?? blank);

  // A project switch or fetched/cleared override resets the draft.
  useEffect(() => {
    setDraft(override ?? { projectId: currentProjectId, channelId: config.id });
    setOpen(!!override);
  }, [override, currentProjectId, config.id]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(override ?? blank);
  const mirrorOptions = allChannels.filter((o) => o.id !== config.id);
  const patch = (p: Partial<ProjectChannelOverride>) => setDraft((cur) => ({ ...cur, ...p }));

  if (!open) {
    return (
      <div style={{ marginTop: 8, fontSize: 11, color: colors.textDim }}>
        <Button onClick={() => setOpen(true)} variant="ghost" size="sm" title={`Customize this channel for ${currentProjectName}`}>
          + Customize for {currentProjectName}
        </Button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10, padding: 10, background: "var(--bg)", border: `1px dashed ${colors.border}`, borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: colors.textDim, fontWeight: 600, marginBottom: 8 }}>Override for {currentProjectName}</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,160px) minmax(0,200px) 1fr auto", gap: 8, alignItems: "center" }}>
        <Select
          value={draft.renderMode ?? "__inherit__"}
          aria-label="Render mode override"
          onChange={(e) => patch({ renderMode: e.target.value === "__inherit__" ? undefined : (e.target.value as ChannelRenderMode) })}
        >
          <option value="__inherit__">Inherit ({config.renderMode})</option>
          <option value="normal">Normal</option>
          <option value="matte">Matte (white on black)</option>
        </Select>
        <Select
          value={draft.mirrorOf ?? "__inherit__"}
          aria-label="Mirror override"
          onChange={(e) => patch({ mirrorOf: e.target.value === "__inherit__" ? undefined : e.target.value || undefined })}
        >
          <option value="__inherit__">Inherit ({config.mirrorOf ? `mirrors ${config.mirrorOf}` : "no mirror"})</option>
          <option value="">No mirror</option>
          {mirrorOptions.map((o) => (
            <option key={o.id} value={o.id}>
              Mirrors {o.name}
            </option>
          ))}
        </Select>
        <OverrideBackground value={draft.background} base={config.background} onChange={(v) => patch({ background: v })} />
        <div style={{ display: "flex", gap: 4 }}>
          {override && (
            <Button onClick={() => void onClearOverride()} variant="ghost" size="sm" title="Remove override; channel falls back to the org default">
              Reset
            </Button>
          )}
          <Button onClick={() => void onSaveOverride(draft)} disabled={!dirty} variant={dirty ? "primary" : "ghost"} size="sm">
            {override ? "Save" : "Apply"}
          </Button>
          {!override && (
            <Button onClick={() => setOpen(false)} variant="ghost" size="sm">
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function OverrideBackground({
  value,
  base,
  onChange,
}: {
  value: string | undefined;
  base: string;
  onChange: (v: string | undefined) => void;
}) {
  const inheriting = value === undefined;
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <Checkbox checked={!inheriting} onChange={(on) => onChange(on ? base : undefined)} label="Background" />
      {!inheriting ? (
        <BackgroundEditor value={value} onChange={(v) => onChange(v)} />
      ) : (
        <span style={{ fontSize: 11, color: colors.textDim }}>Inherit ({base})</span>
      )}
    </div>
  );
}
