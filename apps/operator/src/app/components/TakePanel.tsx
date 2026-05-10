"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Field, Select, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { FieldInput } from "@/lib/FieldInput";

/**
 * Manual take panel — fires arbitrary template + data on program or preview,
 * independent of the rundown. Renders one input per field declared by the
 * selected template (so an image field gets a file picker, a color field
 * gets a color picker, etc.).
 */
export function TakePanel() {
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const templates = useStore((s) => s.templates);
  const templateCache = useStore((s) => s.templateCache);
  const [templateId, setTemplateId] = useState<string>("");
  const [dataByTemplate, setDataByTemplate] = useState<Record<string, Record<string, string>>>({});

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

  function take(channel: "program" | "preview") {
    if (!templateId) return;
    send({ type: "take", channel, templateId, data });
  }
  function update(channel: "program" | "preview") {
    send({ type: "update", channel, data });
  }
  function clear(channel: "program" | "preview") {
    send({ type: "clear", channel });
  }
  function swap() {
    send({ type: "take_pvw_to_pgm", fromChannel: "preview", toChannel: "program" });
  }

  return (
    <div>
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
        <Button onClick={() => take("program")} variant="primary" size="lg" style={{ flex: 1 }}>
          Take ▶ Program
        </Button>
        <Button onClick={() => clear("program")} variant="danger" size="lg" style={{ flex: 1 }}>
          Clear PGM
        </Button>
      </div>

      <div style={row}>
        <Button onClick={() => take("preview")} size="lg" style={{ flex: 1 }}>Cue ▶ Preview</Button>
        <Button onClick={() => clear("preview")} variant="danger" size="lg" style={{ flex: 1 }}>
          Clear PVW
        </Button>
      </div>

      <div style={{ ...row, marginTop: 12 }}>
        <Button onClick={swap} variant="primary" size="lg" style={{ flex: 1 }}>
          ⏎ TAKE  (PVW → PGM)
        </Button>
        <Button onClick={() => update("program")} size="lg" style={{ flex: 1 }}>Update PGM</Button>
      </div>

      <p style={{ marginTop: 16, fontSize: 11, color: colors.textDim }}>
        Space = take program · Esc = clear program · Enter = PVW→PGM swap
      </p>
    </div>
  );
}

const row: React.CSSProperties = { display: "flex", gap: 8, marginTop: 8 };
