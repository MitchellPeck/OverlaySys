"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Field, Select, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { FieldInput } from "@/lib/FieldInput";
import { isCloudMode } from "@/lib/mode";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";

/**
 * Manual take panel — fires arbitrary template + data on the selected program
 * or preview channel, independent of the rundown. Renders one input per field
 * declared by the selected template (so an image field gets a file picker, a
 * color field gets a color picker, etc.).
 *
 * Channels that mirror another (e.g. an alpha key that mirrors program)
 * aren't selectable here — taking on a mirror is a no-op since the renderer
 * subscribes to the source channel's state.
 */
export function TakePanel() {
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const templates = useStore((s) => s.templates);
  const templateCache = useStore((s) => s.templateCache);
  const channelConfigs = useResolvedChannelConfigs();
  const [templateId, setTemplateId] = useState<string>("");
  const [dataByTemplate, setDataByTemplate] = useState<Record<string, Record<string, string>>>({});

  const takeableChannels = useMemo(
    () => channelConfigs.filter((c) => !c.mirrorOf),
    [channelConfigs],
  );

  // Default channel picks fall back to hardcoded "program"/"preview" so the
  // panel still operates without any channel_list message (cloud mode, pre-
  // connect render). Once the WS lands and `takeableChannels` has entries,
  // we prefer channels literally named "program"/"preview", else first two.
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

  // Reconcile selection with the configured channel list. If the channel the
  // user picked has been removed or converted to a mirror, slide back to the
  // current default rather than send takes that land nowhere.
  useEffect(() => {
    if (takeableChannels.length === 0) return;
    if (!takeableChannels.some((c) => c.id === pgmChannel)) setPgmChannel(defaultPgm);
  }, [takeableChannels, pgmChannel, defaultPgm]);
  useEffect(() => {
    if (takeableChannels.length === 0) return;
    if (!takeableChannels.some((c) => c.id === pvwChannel)) setPvwChannel(defaultPvw);
  }, [takeableChannels, pvwChannel, defaultPvw]);

  const selected = templateCache[templateId] ?? null;
  const fields = selected?.fields ?? [];

  useEffect(() => {
    if (!templateId && templates.length > 0) setTemplateId(templates[0]!.id);
  }, [templates, templateId]);

  useEffect(() => {
    if (!templateId) return;
    if (templateCache[templateId]) return;
    if (conn !== "open") return;
    send({ type: "get_template", templateId });
  }, [templateId, templateCache, conn, send]);

  useEffect(() => {
    if (!selected) return;
    setDataByTemplate((cur) => {
      if (cur[selected.id]) return cur;
      const seed: Record<string, string> = {};
      for (const f of selected.fields) {
        if (f.default !== undefined) seed[f.key] = f.default;
      }
      return { ...cur, [selected.id]: seed };
    });
  }, [selected]);

  // Prefill the program-side channel from the template's defaultChannel. We
  // do this every time the selected template changes (not just on mount) so
  // switching between templates with different defaults reflows the channel
  // pick — the operator can still override afterwards. Only honour the hint
  // when it resolves to a takeable (non-mirror) channel that actually
  // exists; stale defaults silently fall through.
  useEffect(() => {
    if (!selected) return;
    const hint = selected.defaultChannel;
    if (!hint) return;
    if (!takeableChannels.some((c) => c.id === hint)) return;
    setPgmChannel(hint);
  }, [selected, takeableChannels]);

  const data = useMemo<Record<string, string>>(
    () => dataByTemplate[templateId] ?? {},
    [dataByTemplate, templateId],
  );

  function setFieldValue(key: string, value: string) {
    setDataByTemplate((cur) => ({
      ...cur,
      [templateId]: { ...(cur[templateId] ?? {}), [key]: value },
    }));
  }

  const cloud = isCloudMode();
  // Channel take/clear/swap requires a live WS to a device. In cloud mode
  // we don't have one yet — Phase 4 wires device pairing. Until then,
  // every fire action is disabled with a hint instead of going nowhere.
  const takesDisabled = cloud;
  const disabledTitle = cloud
    ? "Pair a device to take to a channel"
    : undefined;

  function take(channel: string) {
    if (takesDisabled) return;
    if (!templateId) return;
    send({ type: "take", channel, templateId, data });
  }
  function update(channel: string) {
    if (takesDisabled) return;
    send({ type: "update", channel, data });
  }
  function clear(channel: string) {
    if (takesDisabled) return;
    send({ type: "clear", channel });
  }
  function swap() {
    if (takesDisabled) return;
    send({ type: "take_pvw_to_pgm", fromChannel: pvwChannel, toChannel: pgmChannel });
  }

  function channelLabel(id: string): string {
    const cfg = channelConfigs.find((c) => c.id === id);
    return cfg?.name ?? id;
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
          No device paired. Take, Clear, and Swap are disabled — channels
          render locally on the Electron app, not from the cloud. Sign in
          on a device to enable.
        </div>
      )}
      <Field label="Template">
        <Select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          size="md"
        >
          {templates.length === 0 && <option>(loading…)</option>}
          {templates.map((t) => (
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

      {!selected && templateId && (
        <p style={{ fontSize: 11, color: colors.textDim, margin: "4px 0 12px" }}>
          Loading template fields…
        </p>
      )}

      {selected && fields.length === 0 && (
        <p style={{ fontSize: 11, color: colors.textDim, margin: "4px 0 12px" }}>
          This template declares no fields. Take fires immediately with no data.
        </p>
      )}

      {fields.map((f) => (
        <Field key={f.key} label={f.label}>
          <FieldInput field={f} value={data[f.key]} onChange={(v) => setFieldValue(f.key, v)} />
        </Field>
      ))}

      <div style={row}>
        <Button
          onClick={() => take(pgmChannel)}
          variant="primary"
          size="lg"
          style={{ flex: 1 }}
          disabled={takesDisabled}
          title={disabledTitle}
        >
          Take ▶ {channelLabel(pgmChannel)}
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

      <div style={row}>
        <Button
          onClick={() => take(pvwChannel)}
          size="lg"
          style={{ flex: 1 }}
          disabled={takesDisabled}
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

      <div style={{ ...row, marginTop: 12 }}>
        <Button
          onClick={swap}
          variant="primary"
          size="lg"
          style={{ flex: 1 }}
          disabled={takesDisabled}
          title={disabledTitle}
        >
          ⏎ TAKE  (PVW → PGM)
        </Button>
        <Button
          onClick={() => update(pgmChannel)}
          size="lg"
          style={{ flex: 1 }}
          disabled={takesDisabled}
          title={disabledTitle}
        >
          Update PGM
        </Button>
      </div>

      <p style={{ marginTop: 16, fontSize: 11, color: colors.textDim }}>
        Space = take program · Esc = clear program · Enter = PVW→PGM swap
      </p>
    </div>
  );
}

const row: React.CSSProperties = { display: "flex", gap: 8, marginTop: 8 };

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
      {channels.length === 0 && (
        // Pre-connect / cloud mode: no channel_list yet, but the buttons are
        // disabled anyway. Surface the current value so the dropdown isn't
        // visually empty.
        <option value={value}>{value}</option>
      )}
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
