"use client";

import { useEffect, useMemo, useState } from "react";
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
  // Per-template field values, keyed by templateId so switching templates
  // keeps each one's data around.
  const [dataByTemplate, setDataByTemplate] = useState<Record<string, Record<string, string>>>({});

  const selected = templateCache[templateId] ?? null;
  const fields = selected?.fields ?? [];

  // Default selection to the first template once the list loads.
  useEffect(() => {
    if (!templateId && templates.length > 0) setTemplateId(templates[0]!.id);
  }, [templates, templateId]);

  // Fetch the full template (with fields) when a different template is picked.
  useEffect(() => {
    if (!templateId) return;
    if (templateCache[templateId]) return;
    if (conn !== "open") return;
    send({ type: "get_template", templateId });
  }, [templateId, templateCache, conn, send]);

  // Seed defaults from declared fields the first time we see a template.
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
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          style={selectStyle}
        >
          {templates.length === 0 && <option>(loading…)</option>}
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>

      {!selected && templateId && (
        <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "4px 0 12px" }}>
          Loading template fields…
        </p>
      )}

      {selected && fields.length === 0 && (
        <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "4px 0 12px" }}>
          This template declares no fields. Take fires immediately with no data.
        </p>
      )}

      {fields.map((f) => (
        <Field key={f.key} label={f.label}>
          <FieldInput field={f} value={data[f.key]} onChange={(v) => setFieldValue(f.key, v)} />
        </Field>
      ))}

      <div style={row}>
        <Button onClick={() => take("program")} kind="primary">
          Take ▶ Program
        </Button>
        <Button onClick={() => clear("program")} kind="danger">
          Clear PGM
        </Button>
      </div>

      <div style={row}>
        <Button onClick={() => take("preview")}>Cue ▶ Preview</Button>
        <Button onClick={() => clear("preview")} kind="danger">
          Clear PVW
        </Button>
      </div>

      <div style={{ ...row, marginTop: 12 }}>
        <Button onClick={swap} kind="primary">
          ⏎ TAKE  (PVW → PGM)
        </Button>
        <Button onClick={() => update("program")}>Update PGM</Button>
      </div>

      <p style={{ marginTop: 16, fontSize: 11, color: "var(--text-dim)" }}>
        Space = take program · Esc = clear program · Enter = PVW→PGM swap
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}

function Button({
  children,
  onClick,
  kind = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  kind?: "default" | "primary" | "danger";
}) {
  const bg =
    kind === "primary" ? "var(--accent)" : kind === "danger" ? "transparent" : "var(--panel-2)";
  const color = kind === "primary" ? "#fff" : kind === "danger" ? "var(--red)" : "var(--text)";
  const border = kind === "danger" ? "1px solid var(--red)" : "1px solid var(--border)";
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: "10px 12px",
        background: bg,
        color,
        border,
        borderRadius: 4,
        fontWeight: 600,
        fontSize: 12,
      }}
    >
      {children}
    </button>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text)",
  outline: "none",
};
const row: React.CSSProperties = { display: "flex", gap: 8, marginTop: 8 };
