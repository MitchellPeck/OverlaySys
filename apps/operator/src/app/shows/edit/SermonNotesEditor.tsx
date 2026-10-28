"use client";

import { useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import type { SermonNotes, Show } from "@overlaysys/core";
import { splitPoints } from "@overlaysys/core";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button, IconButton, Input, Panel, Select, colors } from "@overlaysys/ui";
import { notesFromFile } from "@/lib/notesImport";
import { useDialog } from "@/lib/dialog";

/** Compact "Notes set" picker used inside row editors. Hidden when the show has no sets. */
export function NotesSetPicker({
  sets,
  value,
  onChange,
}: {
  sets: SermonNotes[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  if (sets.length === 0) return null;
  return (
    <Select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
      title="Notes set"
      aria-label="Notes set"
      style={{ marginTop: 4 }}
    >
      <option value="">— none —</option>
      {sets.map((n) => (
        <option key={n.id} value={n.id}>
          {n.title || "Untitled notes"}
        </option>
      ))}
    </Select>
  );
}

export function SermonNotesEditor({
  notes,
  onUpdate,
}: {
  notes: SermonNotes[];
  onUpdate: (recipe: (s: Show) => void) => void;
}) {
  const { confirm, dialog } = useDialog();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  function addSet(title: string, body: string) {
    const id = uuid();
    onUpdate((s) => {
      (s.sermonNotes ??= []).push({ id, title, body, updatedAt: new Date().toISOString() });
    });
    setOpen((o) => ({ ...o, [id]: true }));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const { title, body } = await notesFromFile(file);
      addSet(title || "Sermon notes", body);
    } catch (err) {
      setError(`Could not import ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function patchSet(id: string, patch: Partial<Pick<SermonNotes, "title" | "body">>) {
    onUpdate((s) => {
      const set = s.sermonNotes?.find((n) => n.id === id);
      if (!set) return;
      Object.assign(set, patch);
      set.updatedAt = new Date().toISOString();
    });
  }

  async function deleteSet(set: SermonNotes) {
    const ok = await confirm({
      title: "Delete notes set?",
      message: `Delete "${set.title || "Untitled notes"}"? Rows linked to it lose their notes.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    onUpdate((s) => {
      s.sermonNotes = (s.sermonNotes ?? []).filter((n) => n.id !== set.id);
      for (const r of s.rows) {
        if (r.sermonNotesId === set.id) r.sermonNotesId = undefined;
      }
    });
  }

  return (
    <Panel
      title="Sermon notes"
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Button size="sm" onClick={() => addSet("Sermon notes", "")}>
            + New set
          </Button>
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            Import…
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.markdown,.docx"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              void onFile(f);
            }}
          />
        </div>
      }
    >
      {error && <p style={{ color: colors.red, fontSize: 12, margin: "0 0 8px" }}>{error}</p>}
      {notes.length === 0 && (
        <p style={{ color: colors.textDim, fontSize: 12, margin: 0 }}>
          No notes yet. Add a set or import a .docx, .md or .txt file.
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {notes.map((set) => {
          const isOpen = open[set.id] ?? false;
          const points = splitPoints(set.body);
          return (
            <div key={set.id} style={{ border: `1px solid ${colors.border}`, borderRadius: 6, padding: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <IconButton
                  onClick={() => setOpen((o) => ({ ...o, [set.id]: !isOpen }))}
                  title={isOpen ? "Collapse" : "Expand"}
                  size={24}
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </IconButton>
                <Input
                  value={set.title}
                  onChange={(e) => patchSet(set.id, { title: e.target.value })}
                  placeholder="Title"
                />
                <span style={{ color: colors.textDim, fontSize: 11, whiteSpace: "nowrap" }}>
                  {points.length} point{points.length === 1 ? "" : "s"}
                </span>
                <IconButton
                  onClick={() => deleteSet(set)}
                  title="Delete notes set"
                  size={24}
                  style={{ color: colors.red, fontSize: 14 }}
                >
                  ×
                </IconButton>
              </div>
              {isOpen && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <textarea
                      value={set.body}
                      onChange={(e) => patchSet(set.id, { body: e.target.value })}
                      rows={12}
                      spellCheck
                      style={{
                        width: "100%",
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        fontSize: 12,
                        background: colors.panel2,
                        color: colors.text,
                        border: `1px solid ${colors.border}`,
                        borderRadius: 4,
                        padding: 8,
                        resize: "vertical",
                        boxSizing: "border-box",
                      }}
                    />
                    <div style={{ fontSize: 12, color: colors.text, overflow: "auto", maxHeight: 280 }}>
                      <div style={{ color: colors.textDim, marginBottom: 4 }}>
                        {points.length} point{points.length === 1 ? "" : "s"}
                      </div>
                      <ol style={{ margin: 0, paddingLeft: 20 }}>
                        {points.map((p, i) => (
                          <li key={i}>{p.heading || <em style={{ color: colors.textDim }}>(untitled)</em>}</li>
                        ))}
                      </ol>
                    </div>
                  </div>
                  <p style={{ color: colors.textDim, fontSize: 11, margin: "6px 0 0" }}>
                    Start each point with a heading (# Point), or separate points with a blank line.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {dialog}
    </Panel>
  );
}
