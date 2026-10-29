"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SCRIPTURE_FIELD_DESCRIPTORS, suggestScriptureFieldMap } from "@overlaysys/core";
import { Field, colors } from "@overlaysys/ui";
import { TemplateSelect } from "@/app/shows/edit/TemplateSelect";
import { FieldMappingTable } from "@/app/songs/edit/FieldMappingTable";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";

export interface IntroConfig {
  introTemplateId?: string;
  introFieldMap?: Record<string, string>;
  introFieldLiterals?: Record<string, string>;
}

/** Template picker + field mapping for a scripture intro (default or per-row). */
export function ScriptureIntroEditor({ value, onChange }: { value: IntroConfig; onChange(next: IntroConfig): void }) {
  const { send } = useWs();
  const templateCache = useStore((s) => s.templateCache);
  const tplId = value.introTemplateId ?? "";
  const tpl = tplId ? templateCache[tplId] : undefined;
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set());

  // FieldMappingTable can call onChange and onLiteralsChange back-to-back in one
  // event; merging into the latest emitted value keeps the second from
  // clobbering the first with a stale `value`.
  const latest = useRef(value);
  latest.current = value;
  function emit(patch: IntroConfig) {
    latest.current = { ...latest.current, ...patch };
    onChange(latest.current);
  }

  useEffect(() => {
    if (tplId && !tpl) send({ type: "get_template", templateId: tplId });
  }, [tplId, tpl, send]);

  const fields = useMemo(() => tpl?.fields ?? [], [tpl]);
  const suggestions = useMemo(() => suggestScriptureFieldMap(fields), [fields]);

  // A freshly picked template starts from the suggested mapping, like songs.
  // Seeding always defines introFieldMap (possibly {}), so this fires once per
  // newly loaded template; picking another template resets the map to undefined.
  const hasMap = value.introFieldMap !== undefined;
  useEffect(() => {
    if (!tpl || hasMap) return;
    const seeded: Record<string, string> = {};
    for (const [k, m] of Object.entries(suggestions)) if (m.kind !== "none") seeded[k] = m.songFieldKey;
    emit({ introFieldMap: seeded });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl, suggestions, hasMap]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Field label="Intro template">
        <TemplateSelect
          label="Intro template"
          use="title"
          value={tplId}
          emptyLabel="None"
          onChange={(id) => {
            setConfirmed(new Set());
            latest.current = id ? { introTemplateId: id } : {};
            onChange(latest.current);
          }}
        />
      </Field>
      {tplId && !tpl && <p style={{ fontSize: 12, color: colors.textDim }}>Loading template…</p>}
      {tpl && (
        <FieldMappingTable
          templateFields={fields}
          songFields={SCRIPTURE_FIELD_DESCRIPTORS}
          value={value.introFieldMap ?? {}}
          literals={value.introFieldLiterals ?? {}}
          suggestions={suggestions}
          onChange={(m) => emit({ introFieldMap: m })}
          onLiteralsChange={(l) => emit({ introFieldLiterals: l })}
          confirmedKeys={confirmed}
          onConfirm={(key) =>
            setConfirmed((prev) => {
              if (prev.has(key)) return prev;
              const next = new Set(prev);
              next.add(key);
              return next;
            })
          }
        />
      )}
    </div>
  );
}
