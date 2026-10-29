"use client";

import { useMemo, useState } from "react";
import { HOTKEYS, type HotcardMeta, type Hotkey, type TemplateMeta } from "@overlaysys/core";
import { Button, Field, Input, Select, colors, fontSize } from "@overlaysys/ui";
import { hotkeyConflictWarning, hotkeyOwners } from "@/lib/hotcardKeys";
import { templatesForHotcard } from "./hotcardDraft";

/** Template picker grouped "Suggested" / "Other templates". */
export function TemplateSelect({
  metas,
  value,
  onChange,
  lastUsedId,
  ariaLabel = "Template",
}: {
  metas: TemplateMeta[];
  value: string;
  onChange: (id: string) => void;
  lastUsedId?: string;
  ariaLabel?: string;
}) {
  const { suggested, others } = useMemo(() => templatesForHotcard(metas, lastUsedId), [metas, lastUsedId]);
  const known = metas.some((t) => t.id === value);
  return (
    <Select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      {!known && value && <option value={value}>Missing template</option>}
      {suggested.length > 0 && (
        <optgroup label="Suggested">
          {suggested.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label="Other templates">
          {others.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}

export function HotkeySelect({
  value,
  owners,
  onChange,
}: {
  value: Hotkey | null;
  owners: Partial<Record<Hotkey, string[]>>;
  onChange: (v: Hotkey | null) => void;
}) {
  return (
    <Select
      aria-label="F-key"
      value={value ?? ""}
      onChange={(e) => onChange((e.target.value || null) as Hotkey | null)}
    >
      <option value="">None</option>
      {HOTKEYS.map((k) => {
        const taken = owners[k];
        return (
          <option key={k} value={k}>
            {taken ? `${k} (used by ${taken.join(", ")})` : k}
          </option>
        );
      })}
    </Select>
  );
}

export type NewHotcardValues = { name: string; templateId: string; hotkey: Hotkey | null };

/** First step of "New hotcard": name, template and F-key, then Create. */
export function HotcardNewStep({
  metas,
  existing,
  projectId,
  lastUsedId,
  creating,
  error,
  onCreate,
  onCancel,
}: {
  metas: TemplateMeta[];
  existing: HotcardMeta[];
  projectId: string;
  lastUsedId?: string;
  creating: boolean;
  error?: string | null;
  onCreate: (v: NewHotcardValues) => void;
  onCancel: () => void;
}) {
  const defaultId = useMemo(() => templatesForHotcard(metas, lastUsedId).defaultId ?? metas[0]?.id ?? "", [metas, lastUsedId]);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [hotkey, setHotkey] = useState<Hotkey | null>(null);
  const templateId = picked ?? defaultId;
  const warning = hotkeyConflictWarning(existing, { id: "new", name, projectId, hotkey });
  const canCreate = name.trim().length > 0 && !!templateId && !creating;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canCreate) onCreate({ name: name.trim(), templateId, hotkey });
      }}
      style={{ maxWidth: 520, display: "grid", gap: 14 }}
    >
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: colors.text }}>New hotcard</h2>
      <Field label="Name" layout="inline" labelWidth={110}>
        <Input
          autoFocus
          required
          aria-label="Name"
          value={name}
          placeholder="e.g. Welcome lower third"
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Template" layout="inline" labelWidth={110}>
        {metas.length === 0 ? (
          <span style={{ fontSize: fontSize.sm, color: colors.textDim }}>
            No templates yet. Create one in Designs first.
          </span>
        ) : (
          <TemplateSelect metas={metas} value={templateId} onChange={setPicked} lastUsedId={lastUsedId} />
        )}
      </Field>
      <Field label="F-key" layout="inline" labelWidth={110}>
        <HotkeySelect
          value={hotkey}
          owners={hotkeyOwners(existing, projectId, "new")}
          onChange={setHotkey}
        />
        {warning && (
          <div role="alert" style={{ marginTop: 4, fontSize: fontSize.sm, color: colors.warn }}>
            {warning}
          </div>
        )}
      </Field>
      {error && (
        <div role="alert" style={{ fontSize: fontSize.sm, color: colors.dangerText }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={!canCreate}>
          {creating ? "Creating…" : "Create"}
        </Button>
      </div>
    </form>
  );
}
