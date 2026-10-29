"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { StageSettings } from "@overlaysys/core";
import { Button, IconButton, Input, Panel, SaveBar, Switch, colors } from "@overlaysys/ui";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { getStageSettings, putStageSettings } from "@/lib/stageSettingsClient";
import { useSettingsDraft } from "../useSettingsDraft";
import { movePreset, presetsInvalidReason } from "./presetsDraft";

const hint = { color: colors.textDim, fontSize: 12, margin: 0 } as const;

export default function StageSettingsPage() {
  const draft = useSettingsDraft<StageSettings>({
    load: getStageSettings,
    save: putStageSettings,
    validate: (s) => presetsInvalidReason(s.messagePresets),
  });
  const s = draft.value;
  const focusIndex = useRef<number | null>(null);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const count = s?.messagePresets.length ?? 0;

  useEffect(() => {
    if (focusIndex.current !== null) {
      rows.current[focusIndex.current]?.querySelector("input")?.focus();
      focusIndex.current = null;
    }
  }, [count]);

  const bar = draft.bar;
  const actions = useMemo(
    () => <SaveBar {...bar} />,
    [bar],
  );

  const setPresets = (fn: (p: string[]) => string[]) =>
    draft.set((cur) => ({ ...cur, messagePresets: fn(cur.messagePresets) }));

  return (
    <>
      <PageChrome title="Stage monitor" docTitle="Stage monitor settings" actions={s ? actions : undefined} />
      <PageBody variant="form">
        <p style={{ ...hint, fontSize: 13 }}>
          Messages and countdowns shown on stage monitors.{" "}
          <Link href="/design?tab=stage" style={{ color: colors.brand }}>
            Edit stage layouts
          </Link>
        </p>
        {s === null ? (
          <div style={{ color: draft.error ? colors.danger : colors.textDim, fontSize: 13 }}>
            {draft.error ?? "Loading…"}
          </div>
        ) : (
          <>
            {draft.error ? (
              <div role="alert" style={{ color: colors.danger, fontSize: 12 }}>
                {draft.error}
              </div>
            ) : null}
            {draft.changedElsewhere ? (
              <div style={{ color: colors.textDim, fontSize: 12 }}>
                Changed elsewhere. Saving will overwrite those changes.
              </div>
            ) : null}
            <Panel title="Message presets">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <p style={hint}>Tap one on Live to show it on every stage monitor.</p>
                {s.messagePresets.map((p, i) => {
                  const empty = p.trim() === "";
                  return (
                    <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <div
                        ref={(el) => {
                          rows.current[i] = el;
                        }}
                        style={{ display: "flex", gap: 4, alignItems: "center" }}
                      >
                        <Input
                          value={p}
                          maxLength={200}
                          invalid={empty}
                          placeholder="e.g. Wrap up"
                          aria-label={`Preset ${i + 1}`}
                          style={{ flex: 1 }}
                          onChange={(e) =>
                            setPresets((all) => all.map((x, j) => (j === i ? e.target.value : x)))
                          }
                        />
                        <IconButton
                          aria-label={`Move preset ${p || i + 1} up`}
                          disabled={i === 0}
                          onClick={() => setPresets((all) => movePreset(all, i, -1))}
                        >
                          <ChevronUp size={14} />
                        </IconButton>
                        <IconButton
                          aria-label={`Move preset ${p || i + 1} down`}
                          disabled={i === s.messagePresets.length - 1}
                          onClick={() => setPresets((all) => movePreset(all, i, 1))}
                        >
                          <ChevronDown size={14} />
                        </IconButton>
                        <IconButton
                          tone="danger"
                          aria-label={`Delete preset ${p || i + 1}`}
                          onClick={() => setPresets((all) => all.filter((_, j) => j !== i))}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                      {empty ? (
                        <span style={{ color: colors.danger, fontSize: 11 }}>Preset {i + 1} is empty</span>
                      ) : null}
                    </div>
                  );
                })}
                <div>
                  <Button
                    onClick={() => {
                      focusIndex.current = s.messagePresets.length;
                      setPresets((all) => [...all, ""]);
                    }}
                  >
                    Add preset
                  </Button>
                </div>
              </div>
            </Panel>
            <Panel title="Item countdown">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <p style={hint}>Counts down each rundown item&apos;s length on stage monitors.</p>
                <Switch
                  checked={s.autoItemTimer}
                  onChange={(b) => draft.set((cur) => ({ ...cur, autoItemTimer: b }))}
                  label="Start item countdown when a row with a length is taken"
                />
                <Switch
                  checked={s.itemTimerOvertime}
                  onChange={(b) => draft.set((cur) => ({ ...cur, itemTimerOvertime: b }))}
                  label="Item countdown runs into overtime"
                />
              </div>
            </Panel>
          </>
        )}
      </PageBody>
    </>
  );
}
