"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { produce } from "immer";
import type { ChannelConfig, Hotcard, Template } from "@overlaysys/core";
import { Button, Input, Select, colors } from "@overlaysys/ui";
import { useWs, getClient } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { FieldInput } from "@/lib/FieldInput";
import { useDialog } from "@/lib/dialog";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { AppHeader } from "@/app/components/AppHeader";
import { PageShell, PageBody } from "@/app/components/PageShell";
import { isCloudMode } from "@/lib/mode";
import {
  deleteHotcardCloud,
  getHotcardCloud,
  getHotcardUpdatedAtCloud,
  getTemplateCloud,
  refreshHotcardMetasCloud,
  refreshTemplateMetasCloud,
  saveHotcardCloud,
} from "@/lib/cloudData";

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
  const setTemplate = useStore((s) => s.setTemplate);
  const channelConfigs = useResolvedChannelConfigs();
  const takeableChannels = useMemo(
    () => channelConfigs.filter((c) => !c.mirrorOf),
    [channelConfigs],
  );
  const [draft, setDraft] = useState<Hotcard | null>(null);
  const [dirty, setDirty] = useState(false);
  const fetchedRef = useRef<string | null>(null);
  const loadedAtRef = useRef<string | null>(null);
  const { alert, confirm, dialog } = useDialog();
  const cloud = isCloudMode();

  async function showCloudError(action: string, err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.warn(`[hotcards/edit] cloud ${action} failed`, err);
    await alert({
      title: `Cloud ${action} failed`,
      message: (
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, margin: 0 }}>
          {message}
        </pre>
      ),
    });
  }

  useEffect(() => {
    fetchedRef.current = null;
    setDraft(null);
    setDirty(false);
    if (cloud) return;
    const off = getClient().on((msg) => {
      if (msg.type === "hotcard" && msg.hotcard.id === hotcardId) {
        if (!dirty) setDraft(msg.hotcard);
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotcardId, cloud]);

  useEffect(() => {
    if (cloud) {
      if (fetchedRef.current === hotcardId) return;
      fetchedRef.current = hotcardId;
      Promise.all([
        getHotcardCloud(hotcardId),
        getHotcardUpdatedAtCloud(hotcardId),
        refreshTemplateMetasCloud(),
      ])
        .then(([h, updatedAt]) => {
          if (h) setDraft(h);
          loadedAtRef.current = updatedAt;
        })
        .catch((err) => console.warn("[hotcards/edit] cloud load failed", err));
      return;
    }
    if (conn !== "open") return;
    if (fetchedRef.current === hotcardId) return;
    fetchedRef.current = hotcardId;
    send({ type: "get_hotcard", hotcardId });
    send({ type: "list_templates" });
  }, [cloud, conn, hotcardId, send]);

  useEffect(() => {
    if (!draft) return;
    if (templateCache[draft.templateId]) return;
    if (cloud) {
      getTemplateCloud(draft.templateId)
        .then((t) => {
          if (t) setTemplate(t);
        })
        .catch((err) =>
          console.warn(`[hotcards/edit] template ${draft.templateId}`, err),
        );
      return;
    }
    if (conn === "open") {
      send({ type: "get_template", templateId: draft.templateId });
    }
  }, [draft, templateCache, cloud, conn, send, setTemplate]);

  function update(recipe: (h: Hotcard) => void) {
    setDraft((cur) => {
      if (!cur) return cur;
      const next = produce(cur, recipe);
      if (next === cur) return cur;
      setDirty(true);
      return next;
    });
  }

  async function save() {
    if (!draft) return;
    if (cloud) {
      try {
        if (loadedAtRef.current) {
          const cur = await getHotcardUpdatedAtCloud(draft.id);
          if (cur && cur > loadedAtRef.current) {
            const ok = await confirm({
              title: "Cloud has newer changes",
              message: (
                <>
                  This hotcard was updated in the cloud after you loaded it.
                  Save anyway and overwrite their changes?
                </>
              ),
              confirmLabel: "Overwrite",
              destructive: true,
            });
            if (!ok) return;
          }
        }
        await saveHotcardCloud(draft);
        await refreshHotcardMetasCloud();
        loadedAtRef.current = await getHotcardUpdatedAtCloud(draft.id);
        setDirty(false);
      } catch (err) {
        await showCloudError("save", err);
      }
      return;
    }
    send({ type: "save_hotcard", hotcard: draft });
    setDirty(false);
  }

  async function revert() {
    fetchedRef.current = null;
    setDraft(null);
    setDirty(false);
    if (cloud) {
      try {
        const h = await getHotcardCloud(hotcardId);
        if (h) setDraft(h);
      } catch (err) {
        await showCloudError("revert", err);
      }
      return;
    }
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
    if (cloud) {
      try {
        await deleteHotcardCloud(draft.id);
        await refreshHotcardMetasCloud();
        router.push("/hotcards");
      } catch (err) {
        await showCloudError("delete", err);
      }
      return;
    }
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
      <PageShell>
        <AppHeader />
        <PageBody>
          <p style={{ color: colors.textDim, marginTop: 12 }}>
            Loading hotcard <code>{hotcardId}</code>…
          </p>
        </PageBody>
      </PageShell>
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
            <Button
              onClick={save}
              variant="primary"
              size="sm"
              disabled={!dirty || (!cloud && conn !== "open")}
            >
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
            <ChannelHintSelect
              value={draft.channelHint}
              onChange={(v) =>
                update((h) => {
                  h.channelHint = v;
                })
              }
              channels={takeableChannels}
            />
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

function ChannelHintSelect({
  value,
  onChange,
  channels,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  channels: ChannelConfig[];
}) {
  const current = value ?? "";
  const knownChannel = current && channels.some((c) => c.id === current);
  return (
    <Select
      value={current}
      onChange={(e) => onChange(e.target.value ? e.target.value : undefined)}
    >
      <option value="">(any)</option>
      {!knownChannel && current && (
        <option value={current}>{current} (missing)</option>
      )}
      {channels.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
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
