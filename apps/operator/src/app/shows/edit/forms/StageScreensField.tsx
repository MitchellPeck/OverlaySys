"use client";

import { useMemo } from "react";
import { BUILT_IN_STAGE_LAYOUTS, stageLayoutMeta } from "@overlaysys/core";
import { Select, colors, fontSize } from "@overlaysys/ui";
import { nextStageLayouts } from "@/lib/stageLayoutOverrides";
import { useStore } from "@/lib/store";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";

/**
 * Per-stage-screen layout override for one row. Unset = "Use screen rules".
 * Keys for screens that no longer exist are kept untouched (data safety).
 */
export function StageScreensField(p: {
  value: Record<string, string> | undefined;
  onChange(next: Record<string, string> | undefined): void;
}) {
  const channels = useResolvedChannelConfigs();
  const metas = useStore((s) => s.stageLayouts);
  const screens = useMemo(() => channels.filter((c) => c.kind === "stage" && !c.mirrorOf), [channels]);
  const layouts = metas.length > 0 ? metas : BUILT_IN_STAGE_LAYOUTS.map(stageLayoutMeta);
  if (screens.length === 0) {
    return <div style={{ fontSize: fontSize.xs, color: colors.textMuted }}>No stage screens are set up.</div>;
  }
  const set = (channel: string, layoutId: string) => p.onChange(nextStageLayouts(p.value, channel, layoutId));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {screens.map((c) => {
        const cur = p.value?.[c.id] ?? "";
        const missing = cur && !layouts.some((l) => l.id === cur);
        return (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: "0 0 120px", fontSize: fontSize.sm, color: colors.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.name}
            </span>
            <Select
              aria-label={`${c.name} layout`}
              value={cur}
              onChange={(e) => set(c.id, e.target.value)}
              style={{ maxWidth: 260, minWidth: 160 }}
            >
              <option value="">Use screen rules</option>
              {missing && <option value={cur}>(missing layout)</option>}
              {layouts.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
        );
      })}
    </div>
  );
}
