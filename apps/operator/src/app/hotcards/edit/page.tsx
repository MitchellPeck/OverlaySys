"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { produce } from "immer";
import type { Hotcard, Template } from "@overlaysys/core";
import { Button, Input, Select, colors } from "@overlaysys/ui";
import { useWs, getClient } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { FieldInput } from "@/lib/FieldInput";
import { useDialog } from "@/lib/dialog";
import { AppHeader } from "@/app/components/AppHeader";

export default function HotcardEditPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <HotcardEditPageInner />
    </Suspense>
  );
}

function HotcardEditPageInner() {
  const searchParams = useSearchParams();
  const hotcardId = decodeURIComponent(searchParams?.get("id") ?? "");
  const { send } = useWs();
  const router = useRouter();
  const conn = useStore((s) => s.conn);
  const templates = useStore((s) => s.templates);
  const templateCache = useStore((s) => s.templateCache);
  const [draft, setDraft] = useState<Hotcard | null>(null);
  const [dirty, setDirty] = useState(false);
  const fetchedRef = useRef<string | null>(null);
  const { confirm, dialog } = useDialog();

  useEffect(() => {
    fetchedRef.current = null;
    setDraft(null);
    setDirty(false);
    const off = getClient().on((msg) => {
      if (msg.type === "hotcard" && msg.hotcard.id === hotcardId) {
        if (!dirty) setDraft(msg.hotcard);
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotcardId]);

  useEffect(() => {
    if (conn !== "open") return;
    if (fetchedRef.current === hotcardId) return;
    fetchedRef.current = hotcardId;
    send({ type: "get_hotcard", hotcardId });
    send({ type: "list_templates" });
  }, [conn, hotcardId, send]);

  useEffect(() => {
    if (!draft || conn !== "open") return;
    if (!templateCache[draft.templateId]) {
      send({ type: "get_template", templateId: draft.templateId });
    }
  }, [draft, templateCache, conn, send]);

  function update(recipe: (h: Hotcard) => void) {
    setDraft((cur) => {
      if (!cur) return cur;
      const next = produce(cur, recipe);
      if (next === cur) return cur;
      setDirty(true);
      return next;
    });
  }

  function save() {
    if (!draft) return;
    send({ type: "save_hotcard", hotcard: draft });
    setDirty(false);
  }

  function revert() {
    fetchedRef.current = null;
    setDraft(null);
    setDirty(false);
    send({ type: "get_hotcard", hotcardId });
  }

  async function remove() {
    if (!draft) return;
    const ok = await confirm({
      title: "Delete hotcard",
      message: (
        <>
          Delete <strong>{draft.name}</strong>?
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    send({ type: "delete_hotcard", hotcardId: draft.id });
    setTimeout(() => router.push("/hotcards"), 150);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyS") {
        e.preventDefault();
        save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  if (!draft) {
    return (
      <>
        <AppHeader />
        <main style={{ padding: 24 }}>
          <p style={{ color: colors.textDim, marginTop: 12 }}>
            Loading hotcard <code>{hotcardId}</code>…
          </p>
        </main>
      </>
    );
  }

  const template = templateCache[draft.templateId] ?? null;

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        overflow: "hidden",
      }}
    >
      <AppHeader
        context={
          <>
            <input
              value={draft.name}
              onChange={(e) => update((h) => { h.name = e.target.value; })}
              style={{
                background: "transparent",
                border: "1px solid transparent",
                color: colors.text,
                fontSize: 15,
                fontWeight: 600,
                padding: "2px 6px",
                borderRadius: 4,
                minWidth: 200,
              }}
            />
            <span style={{ color: colors.textDim, fontSize: 11 }}>{draft.id}</span>
            {dirty && (
              <span style={{ color: colors.accent2, fontSize: 11, fontWeight: 600 }}>
                ● unsaved
              </span>
            )}
          </>
        }
        actions={
          <>
            <Button onClick={remove} variant="danger" size="sm">Delete</Button>
            <Button onClick={revert} variant="ghost" size="sm" disabled={!dirty}>Revert</Button>
            <Button onClick={save} variant="primary" size="sm" disabled={!dirty || conn !== "open"}>
              Save (⌘S)
            </Button>
          </>
        }
      />

      <div style={{ overflow: "auto", padding: "16px 24px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: 16 }}>
          <Row label="Template">
            <Select
              value={draft.templateId}
              onChange={(e) => update((h) => { h.templateId = e.target.value; })}
            >
              {!templates.some((t) => t.id === draft.templateId) && (
                <option value={draft.templateId}>{draft.templateId} (missing)</option>
              )}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Row>

          <Row label="Channel hint">
            <Select
              value={draft.channelHint ?? ""}
              onChange={(e) =>
                update((h) => {
                  h.channelHint = e.target.value ? e.target.value : undefined;
                })
              }
            >
              <option value="">(any)</option>
              <option value="program">program</option>
              <option value="preview">preview</option>
            </Select>
          </Row>

          <Row label="Notes">
            <Input
              value={draft.notes ?? ""}
              onChange={(e) =>
                update((h) => {
                  h.notes = e.target.value || undefined;
                })
              }
              placeholder="—"
            />
          </Row>

          <div>
            <h3
              style={{
                margin: 0,
                marginBottom: 8,
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 1.2,
                color: colors.textDim,
              }}
            >
              Fields
            </h3>
            <FieldsEditor
              template={template}
              data={draft.data}
              onChange={(key, value) =>
                update((h) => {
                  h.data = { ...h.data, [key]: value };
                })
              }
            />
          </div>
        </div>
      </div>
      {dialog}
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span
        style={{
          width: 110,
          flexShrink: 0,
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 1.2,
          color: colors.textDim,
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function FieldsEditor({
  template,
  data,
  onChange,
}: {
  template: Template | null;
  data: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const declaredKeys = useMemo(
    () => template?.fields.map((f) => f.key) ?? [],
    [template],
  );
  const orphanKeys = Object.keys(data).filter((k) => !declaredKeys.includes(k));
  const fieldsToShow = template?.fields ?? [];

  if (!template) {
    return (
      <span style={{ color: colors.textDim, fontSize: 11 }}>
        Loading template…
      </span>
    );
  }

  if (fieldsToShow.length === 0 && orphanKeys.length === 0) {
    return (
      <span style={{ color: colors.textDim, fontSize: 11 }}>
        Template declares no fields.
      </span>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {fieldsToShow.map((f) => (
        <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 110, fontSize: 12, color: colors.textDim, flexShrink: 0 }}>
            {f.label}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <FieldInput field={f} value={data[f.key]} onChange={(v) => onChange(f.key, v)} />
          </div>
        </div>
      ))}
      {orphanKeys.map((k) => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.7 }}>
          <span
            style={{ width: 110, fontSize: 12, color: colors.accent2, flexShrink: 0 }}
            title="Not declared by the template — will still be sent on take."
          >
            {k}*
          </span>
          <Input
            value={data[k] ?? ""}
            onChange={(e) => onChange(k, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}
