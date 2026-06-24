"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Field, Input, Select, colors } from "@overlaysys/ui";
import type { Field as TemplateField, Template } from "@overlaysys/core";
import {
  computeTimeDisplay,
  encodeTimerValue,
  isTimeField,
  parseDuration,
} from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { FieldInput } from "@/lib/FieldInput";
import { isCloudMode } from "@/lib/mode";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";

/**
 * Dedicated panel for time-based takes (countdowns / count-ups / clocks).
 *
 * Differs from TakePanel in two ways:
 *
 *  1. Template list is filtered to templates that contain ≥1 time field.
 *  2. For countdowns the operator types a **duration** ("10:00") rather than
 *     an absolute anchor. The duration is re-stamped to `Date.now() + ms`
 *     each time Start / Cue fires, so the timer always starts from zero —
 *     the operator can type "10:00" once and start it whenever the cue
 *     actually arrives.
 *
 * Non-time fields in the same template still render with the standard
 * FieldInput, so a timer template can carry a label, color, etc.
 */
export function TimerPanel() {
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const templates = useStore((s) => s.templates);
  const templateCache = useStore((s) => s.templateCache);
  const channelConfigs = useResolvedChannelConfigs();

  const [templateId, setTemplateId] = useState<string>("");
  // Per-template intent state — countdown duration text is the source of
  // truth here, not a stale anchor. Indexed [templateId][fieldKey].
  const [durationByField, setDurationByField] = useState<
    Record<string, Record<string, string>>
  >({});
  // Non-time field data, mirrors TakePanel's per-template cache.
  const [dataByTemplate, setDataByTemplate] = useState<
    Record<string, Record<string, string>>
  >({});

  const takeableChannels = useMemo(
    () => channelConfigs.filter((c) => !c.mirrorOf),
    [channelConfigs],
  );
  const defaultPgm = useMemo(() => {
    if (takeableChannels.some((c) => c.id === "program")) return "program";
    return takeableChannels[0]?.id ?? "program";
  }, [takeableChannels]);
  const defaultPvw = useMemo(() => {
    if (takeableChannels.some((c) => c.id === "preview")) return "preview";
    const notPgm = takeableChannels.find((c) => c.id !== defaultPgm);
    return notPgm?.id ?? takeableChannels[0]?.id ?? "preview";
  }, [takeableChannels, defaultPgm]);
  const [pgmChannel, setPgmChannel] = useState<string>(defaultPgm);
  const [pvwChannel, setPvwChannel] = useState<string>(defaultPvw);
  useEffect(() => {
    if (takeableChannels.length === 0) return;
    if (!takeableChannels.some((c) => c.id === pgmChannel)) setPgmChannel(defaultPgm);
  }, [takeableChannels, pgmChannel, defaultPgm]);
  useEffect(() => {
    if (takeableChannels.length === 0) return;
    if (!takeableChannels.some((c) => c.id === pvwChannel)) setPvwChannel(defaultPvw);
  }, [takeableChannels, pvwChannel, defaultPvw]);

  // Filter templates to those that declare ≥1 time field. We can only check
  // templates whose full body is cached — for the rest, defer to the cache
  // population effect below.
  const timerTemplateIds = useMemo(() => {
    const ids: string[] = [];
    for (const meta of templates) {
      const cached = templateCache[meta.id];
      if (!cached) continue;
      if (cached.fields.some(isTimeField)) ids.push(meta.id);
    }
    return ids;
  }, [templates, templateCache]);

  const timerTemplates = useMemo(
    () => templates.filter((t) => timerTemplateIds.includes(t.id)),
    [templates, timerTemplateIds],
  );

  const selected: Template | null = templateCache[templateId] ?? null;
  const timeFields = useMemo(
    () => (selected ? selected.fields.filter(isTimeField) : []),
    [selected],
  );
  const otherFields = useMemo(
    () => (selected ? selected.fields.filter((f) => !isTimeField(f)) : []),
    [selected],
  );

  // Eagerly fetch full template bodies so we can filter the dropdown by
  // "has a time field." Without this, a freshly-loaded operator would see
  // an empty Timer panel even when timer templates exist.
  useEffect(() => {
    if (conn !== "open") return;
    for (const meta of templates) {
      if (!templateCache[meta.id]) {
        send({ type: "get_template", templateId: meta.id });
      }
    }
  }, [templates, templateCache, conn, send]);

  // Pick the first timer template once one is available.
  useEffect(() => {
    if (!templateId && timerTemplates.length > 0) {
      setTemplateId(timerTemplates[0]!.id);
    }
  }, [timerTemplates, templateId]);

  // Seed non-time field defaults on first selection.
  useEffect(() => {
    if (!selected) return;
    setDataByTemplate((cur) => {
      if (cur[selected.id]) return cur;
      const seed: Record<string, string> = {};
      for (const f of selected.fields) {
        if (!isTimeField(f) && f.default !== undefined) seed[f.key] = f.default;
      }
      return { ...cur, [selected.id]: seed };
    });
  }, [selected]);

  const cloud = isCloudMode();
  const takesDisabled = cloud;
  const disabledTitle = cloud ? "Pair a device to take to a channel" : undefined;

  const otherData = useMemo<Record<string, string>>(
    () => dataByTemplate[templateId] ?? {},
    [dataByTemplate, templateId],
  );
  const durations = useMemo<Record<string, string>>(
    () => durationByField[templateId] ?? {},
    [durationByField, templateId],
  );

  function setOtherFieldValue(key: string, value: string): void {
    setDataByTemplate((cur) => ({
      ...cur,
      [templateId]: { ...(cur[templateId] ?? {}), [key]: value },
    }));
  }
  function setDuration(key: string, value: string): void {
    setDurationByField((cur) => ({
      ...cur,
      [templateId]: { ...(cur[templateId] ?? {}), [key]: value },
    }));
  }

  /**
   * Stamp anchors at fire-time so each Start / Cue restarts the clock. Each
   * time field becomes a `data[key]` entry pointing at an epoch-ms anchor
   * (clock fields skip — the renderer reads `Date.now()`).
   */
  function buildData(): Record<string, string> {
    const data: Record<string, string> = { ...otherData };
    const now = Date.now();
    for (const f of timeFields) {
      const mode = f.timeMode ?? "countdown";
      if (mode === "countdown") {
        const ms = parseDuration(durations[f.key] ?? "");
        if (ms == null) continue; // skip unparseable; renderer falls back to 00:00
        // Carry durationMs so the Active timers panel's Reset action can
        // re-derive a fresh anchor without asking the operator to retype.
        data[f.key] = encodeTimerValue({ anchor: now + ms, durationMs: ms });
      } else if (mode === "countup") {
        data[f.key] = encodeTimerValue({ anchor: now });
      }
      // clock: no anchor needed
    }
    return data;
  }

  function fire(channel: string, kind: "take" | "cue"): void {
    if (takesDisabled) return;
    if (!templateId) return;
    const data = buildData();
    send({ type: kind, channel, templateId, data });
  }
  function clear(channel: string): void {
    if (takesDisabled) return;
    send({ type: "clear", channel });
  }
  function swap(): void {
    if (takesDisabled) return;
    send({ type: "take_pvw_to_pgm", fromChannel: pvwChannel, toChannel: pgmChannel });
  }

  function channelLabel(id: string): string {
    return channelConfigs.find((c) => c.id === id)?.name ?? id;
  }

  return (
    <div>
      {cloud && (
        <div
          style={{
            padding: "8px 10px",
            marginBottom: 10,
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text-dim)",
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          No device paired. Start / Clear / Swap are disabled — timers render
          on the Electron app, not from the cloud.
        </div>
      )}

      <Field label="Template">
        <Select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          size="md"
        >
          {timerTemplates.length === 0 && (
            <option value="">
              {templates.length === 0 ? "(loading…)" : "(no time-aware templates)"}
            </option>
          )}
          {timerTemplates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Field label="Program channel">
            <ChannelSelect
              value={pgmChannel}
              onChange={setPgmChannel}
              channels={takeableChannels}
            />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Preview channel">
            <ChannelSelect
              value={pvwChannel}
              onChange={setPvwChannel}
              channels={takeableChannels}
            />
          </Field>
        </div>
      </div>

      {timerTemplates.length === 0 && templates.length > 0 && (
        <p style={{ fontSize: 11, color: colors.textDim, margin: "8px 0" }}>
          No templates declare a time field yet. Add a field of type{" "}
          <strong>time</strong> in the template editor to make a template show up here.
        </p>
      )}

      {selected && timeFields.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <SectionLabel>Timer fields</SectionLabel>
          {timeFields.map((f) => (
            <TimerFieldRow
              key={f.key}
              field={f}
              duration={durations[f.key] ?? ""}
              onDuration={(v) => setDuration(f.key, v)}
            />
          ))}
        </div>
      )}

      {selected && otherFields.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <SectionLabel>Other fields</SectionLabel>
          {otherFields.map((f) => (
            <Field key={f.key} label={f.label}>
              <FieldInput
                field={f}
                value={otherData[f.key]}
                onChange={(v) => setOtherFieldValue(f.key, v)}
              />
            </Field>
          ))}
        </div>
      )}

      <div style={{ ...rowStyle, marginTop: 12 }}>
        <Button
          onClick={() => fire(pgmChannel, "take")}
          variant="primary"
          size="lg"
          style={{ flex: 1 }}
          disabled={takesDisabled || !templateId}
          title={disabledTitle}
        >
          Start ▶ {channelLabel(pgmChannel)}
        </Button>
        <Button
          onClick={() => clear(pgmChannel)}
          variant="danger"
          size="lg"
          style={{ flex: 1 }}
          disabled={takesDisabled}
          title={disabledTitle}
        >
          Clear PGM
        </Button>
      </div>

      <div style={rowStyle}>
        <Button
          onClick={() => fire(pvwChannel, "cue")}
          size="lg"
          style={{ flex: 1 }}
          disabled={takesDisabled || !templateId}
          title={disabledTitle}
        >
          Cue ▶ {channelLabel(pvwChannel)}
        </Button>
        <Button
          onClick={() => clear(pvwChannel)}
          variant="danger"
          size="lg"
          style={{ flex: 1 }}
          disabled={takesDisabled}
          title={disabledTitle}
        >
          Clear PVW
        </Button>
      </div>

      <div style={{ ...rowStyle, marginTop: 12 }}>
        <Button
          onClick={swap}
          variant="primary"
          size="lg"
          style={{ flex: 1 }}
          disabled={takesDisabled}
          title={disabledTitle}
        >
          ⏎ TAKE (PVW → PGM)
        </Button>
      </div>
    </div>
  );
}

/**
 * Per-time-field row: label + mode-specific input + live preview. The
 * preview ticks once a second using the same `computeTimeDisplay` helper
 * the renderer uses, so authors and operators see the same value.
 */
function TimerFieldRow({
  field,
  duration,
  onDuration,
}: {
  field: TemplateField;
  duration: string;
  onDuration: (v: string) => void;
}) {
  const mode = field.timeMode ?? "countdown";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8,
        alignItems: "end",
        marginBottom: 8,
      }}
    >
      <Field label={`${field.label} (${mode})`}>
        {mode === "countdown" ? (
          <Input
            value={duration}
            onChange={(e) => onDuration(e.target.value)}
            placeholder="10:00"
            title="Duration to count down. Format: SS, MM:SS, or HH:MM:SS."
          />
        ) : mode === "countup" ? (
          <span style={{ fontSize: 11, color: colors.textDim, fontStyle: "italic" }}>
            start anchor is stamped on Start / Cue
          </span>
        ) : (
          <span style={{ fontSize: 11, color: colors.textDim, fontStyle: "italic" }}>
            live wall-clock — no input
          </span>
        )}
      </Field>
      <Field label="Preview">
        <LivePreview field={field} duration={duration} />
      </Field>
    </div>
  );
}

/**
 * Reads the same `computeTimeDisplay` the renderer uses so the operator
 * sees exactly what'll go on air. Ticks every 500ms — enough to feel
 * live without burning CPU on a preview that isn't critical-path.
 */
function LivePreview({
  field,
  duration,
}: {
  field: TemplateField;
  duration: string;
}) {
  const mode = field.timeMode ?? "countdown";
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  let value: string | undefined;
  if (mode === "countdown") {
    const ms = parseDuration(duration);
    if (ms != null) value = String(now + ms);
  } else if (mode === "countup") {
    value = String(now);
  }
  const display = computeTimeDisplay(field, value, now);
  return (
    <span
      style={{
        fontSize: 16,
        fontFamily: "ui-monospace, monospace",
        padding: "6px 10px",
        background: "var(--panel-2)",
        border: `1px solid ${colors.border}`,
        borderRadius: 4,
        display: "inline-block",
        color: colors.text,
      }}
    >
      {display}
    </span>
  );
}

function ChannelSelect({
  value,
  onChange,
  channels,
}: {
  value: string;
  onChange: (v: string) => void;
  channels: { id: string; name: string }[];
}) {
  const hasCurrent = channels.some((c) => c.id === value);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} size="md">
      {channels.length === 0 && <option value={value}>{value}</option>}
      {!hasCurrent && channels.length > 0 && (
        <option value={value}>{value} (missing)</option>
      )}
      {channels.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: 1.2,
        color: colors.textDim,
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

const rowStyle: React.CSSProperties = { display: "flex", gap: 8, marginTop: 8 };
