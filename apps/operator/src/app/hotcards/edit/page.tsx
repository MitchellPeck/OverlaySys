"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { produce } from "immer";
import { MoreHorizontal } from "lucide-react";
import { v4 as uuid } from "uuid";
import { type ChannelConfig, type Hotcard, type Template } from "@overlaysys/core";
import {
  Field,
  IconButton,
  Input,
  Menu,
  SaveBar,
  Select,
  colors,
  confirm,
  fontSize,
  toast,
  type MenuItem,
} from "@overlaysys/ui";
import { hotkeyConflictWarning, hotkeyOwners } from "@/lib/hotcardKeys";
import { useWs, getClient } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { FieldInput } from "@/lib/FieldInput";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { isCloudMode } from "@/lib/mode";
import { isNotFoundFor, loadFailedText } from "@/lib/editorLoad";
import { EditorLoadFailed } from "@/app/components/EditorLoadFailed";
import { ackErrorText, sendAndAwaitAck } from "@/lib/awaitAck";
import { useConnection } from "@/lib/useConnection";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { TemplateThumbnail } from "@/lib/thumbnails/TemplateThumbnail";
import {
  deleteHotcardCloud,
  getHotcardCloud,
  getHotcardUpdatedAtCloud,
  getTemplateCloud,
  refreshHotcardMetasCloud,
  refreshProjectsCloud,
  refreshTemplateMetasCloud,
  saveHotcardCloud,
} from "@/lib/cloudData";
import { LAST_HOTCARD_TEMPLATE_KEY, hotcardEqual } from "./hotcardDraft";
import { HotcardNewStep, HotkeySelect, TemplateSelect, type NewHotcardValues } from "./HotcardNewStep";

const PREVIEW_WIDTH = 480;

export default function HotcardEditPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <HotcardEditPageInner />
    </Suspense>
  );
}

function readLastTemplate(): string | undefined {
  try {
    return window.localStorage.getItem(LAST_HOTCARD_TEMPLATE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function HotcardEditPageInner() {
  const searchParams = useSearchParams();
  const isNew = searchParams?.get("new") === "1";
  const hotcardId = decodeURIComponent(searchParams?.get("id") ?? "");
  const { send } = useWs();
  const router = useRouter();
  const { connected } = useConnection();
  const conn = useStore((s) => s.conn);
  const templates = useStore((s) => s.templates);
  const templateCache = useStore((s) => s.templateCache);
  const allHotcards = useStore((s) => s.hotcards);
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const setTemplate = useStore((s) => s.setTemplate);
  const channelConfigs = useResolvedChannelConfigs();
  const takeableChannels = useMemo(
    () => channelConfigs.filter((c) => !c.mirrorOf),
    [channelConfigs],
  );
  const [saved, setSaved] = useState<Hotcard | null>(null);
  const [draft, setDraft] = useState<Hotcard | null>(null);
  const [saving, setSaving] = useState(false);
  /** Why the hotcard can't be shown: not found, or the load failed. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const fetchedRef = useRef<string | null>(null);
  const loadedAtRef = useRef<string | null>(null);
  const cloud = isCloudMode();

  const dirty = !!draft && !!saved && !hotcardEqual(draft, saved);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // A new id (or the new flow) starts from nothing.
  useEffect(() => {
    fetchedRef.current = null;
    setSaved(null);
    setDraft(null);
    setLoadError(null);
    if (cloud || isNew) return;
    const off = getClient().on((msg) => {
      if (msg.type === "hotcard" && msg.hotcard.id === hotcardId) {
        setSaved(msg.hotcard);
        if (!dirtyRef.current) setDraft(msg.hotcard);
      } else if (isNotFoundFor(msg, hotcardId) && !draftRef.current) {
        setLoadError("This hotcard doesn't exist (it may have been deleted).");
      }
    });
    return off;
  }, [hotcardId, cloud, isNew]);

  // Lists the page needs (templates, projects) whatever the mode.
  useEffect(() => {
    if (cloud) {
      Promise.all([refreshTemplateMetasCloud(), refreshProjectsCloud(), refreshHotcardMetasCloud()]).catch((err) =>
        console.warn("[hotcards/edit] cloud lists failed", err),
      );
      return;
    }
    if (conn !== "open") return;
    send({ type: "list_templates" });
    send({ type: "list_projects" });
    send({ type: "list_hotcards" });
  }, [cloud, conn, send]);

  const loadCard = useCallback(async () => {
    if (!hotcardId) return;
    if (cloud) {
      try {
        const [h, updatedAt] = await Promise.all([getHotcardCloud(hotcardId), getHotcardUpdatedAtCloud(hotcardId)]);
        if (h) {
          setSaved(h);
          setDraft(h);
        } else {
          setLoadError("This hotcard doesn't exist (it may have been deleted).");
        }
        loadedAtRef.current = updatedAt;
      } catch (err) {
        console.warn("[hotcards/edit] cloud load failed", err);
        setLoadError(loadFailedText("hotcard", err));
      }
      return;
    }
    send({ type: "get_hotcard", hotcardId });
  }, [cloud, hotcardId, send]);

  useEffect(() => {
    if (isNew || !hotcardId) return;
    if (!cloud && conn !== "open") return;
    if (fetchedRef.current === hotcardId) return;
    fetchedRef.current = hotcardId;
    void loadCard();
  }, [isNew, cloud, conn, hotcardId, loadCard]);

  useEffect(() => {
    if (!draft) return;
    if (templateCache[draft.templateId]) return;
    if (cloud) {
      getTemplateCloud(draft.templateId)
        .then((t) => {
          if (t) setTemplate(t);
        })
        .catch((err) => console.warn(`[hotcards/edit] template ${draft.templateId}`, err));
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
      return next === cur ? cur : next;
    });
  }

  /** Write `h`; throws on failure. Cloud asks before overwriting newer cloud edits. */
  async function persist(h: Hotcard, opts: { checkNewer: boolean }): Promise<boolean> {
    if (cloud) {
      if (opts.checkNewer && loadedAtRef.current) {
        const cur = await getHotcardUpdatedAtCloud(h.id);
        if (cur && cur > loadedAtRef.current) {
          const ok = await confirm({
            title: "Cloud has newer changes",
            message: "This hotcard was updated in the cloud after you loaded it. Save anyway and overwrite their changes?",
            confirmLabel: "Overwrite",
            danger: true,
          });
          if (!ok) return false;
        }
      }
      await saveHotcardCloud(h);
      await refreshHotcardMetasCloud();
      loadedAtRef.current = await getHotcardUpdatedAtCloud(h.id);
      return true;
    }
    await sendAndAwaitAck(getClient(), { type: "save_hotcard", hotcard: h }, { op: "save_hotcard", id: h.id });
    return true;
  }

  const save = useCallback(async (): Promise<boolean> => {
    const h = draftRef.current;
    if (!h || saving) return false;
    setSaving(true);
    try {
      const ok = await persist(h, { checkNewer: true });
      if (!ok) return false;
      setSaved(h);
      try {
        window.localStorage.setItem(LAST_HOTCARD_TEMPLATE_KEY, h.templateId);
      } catch {
        /* storage unavailable */
      }
      toast({ tone: "ok", message: "Saved" });
      return true;
    } catch (e) {
      toast({ tone: "error", message: `Not saved: ${ackErrorText(e)}` });
      return false;
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, cloud]);

  function revert() {
    setDraft(saved);
  }

  useUnsavedGuard(dirty, {
    onSave: save,
    resetKey: hotcardId,
    canArm: !!draft && draft.id === hotcardId,
  });

  async function remove() {
    if (!draft) return;
    const ok = await confirm({
      title: "Delete hotcard",
      message: `Delete "${draft.name}"?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      if (cloud) {
        await deleteHotcardCloud(draft.id);
        await refreshHotcardMetasCloud();
      } else {
        await sendAndAwaitAck(getClient(), { type: "delete_hotcard", hotcardId: draft.id }, { op: "delete_hotcard", id: draft.id });
      }
      // Gone: nothing left to guard.
      setSaved(draft);
      router.push("/hotcards");
    } catch (e) {
      toast({ tone: "error", message: `Not deleted: ${ackErrorText(e)}` });
    }
  }

  async function duplicate() {
    const src = saved;
    if (!src) return;
    const copy: Hotcard = { ...src, id: `hotcard-${uuid().slice(0, 8)}`, name: `${src.name} (copy)`, hotkey: null };
    try {
      await persist(copy, { checkNewer: false });
      toast({
        tone: "ok",
        message: `Duplicated as "${copy.name}"`,
        action: { label: "Open", onClick: () => router.push(`/hotcards/edit?id=${encodeURIComponent(copy.id)}`) },
      });
    } catch (e) {
      toast({ tone: "error", message: `Not duplicated: ${ackErrorText(e)}` });
    }
  }

  function copyId() {
    if (!draft) return;
    navigator.clipboard
      ?.writeText(draft.id)
      .then(() => toast({ tone: "ok", message: "Id copied" }))
      .catch(() => toast({ tone: "error", message: "Could not copy the id" }));
  }

  async function create(v: NewHotcardValues) {
    setCreating(true);
    setCreateError(null);
    const h: Hotcard = {
      id: `hotcard-${uuid().slice(0, 8)}`,
      name: v.name,
      projectId: currentProjectId,
      templateId: v.templateId,
      data: {},
      hotkey: v.hotkey,
    };
    try {
      await persist(h, { checkNewer: false });
      try {
        window.localStorage.setItem(LAST_HOTCARD_TEMPLATE_KEY, h.templateId);
      } catch {
        /* storage unavailable */
      }
      router.replace(`/hotcards/edit?id=${encodeURIComponent(h.id)}`);
    } catch (e) {
      setCreateError(`Not created: ${ackErrorText(e)}`);
    } finally {
      setCreating(false);
    }
  }

  if (isNew) {
    return (
      <>
        <PageChrome title="New hotcard" />
        <PageBody variant="form">
          <HotcardNewStep
            metas={templates}
            existing={allHotcards}
            projectId={currentProjectId}
            lastUsedId={readLastTemplate()}
            creating={creating}
            error={createError}
            onCreate={(v) => void create(v)}
            onCancel={() => router.push("/hotcards")}
          />
        </PageBody>
      </>
    );
  }

  if (!draft && loadError) {
    return <EditorLoadFailed message={loadError} backLabel="Back to hotcards" onBack={() => router.push("/hotcards")} />;
  }
  if (!draft) {
    return (
      <>
        <PageChrome />
        <PageBody style={{ height: "100%" }}>
          <p style={{ color: colors.textDim, marginTop: 12 }}>Loading hotcard…</p>
        </PageBody>
      </>
    );
  }

  const template = templateCache[draft.templateId] ?? null;
  const keyWarning = hotkeyConflictWarning(allHotcards, draft);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  const menuItems: MenuItem[] = [
    { id: "duplicate", label: "Duplicate", onSelect: () => void duplicate() },
    { id: "copy-id", label: "Copy id", onSelect: copyId },
    { separator: true },
    { id: "delete", label: "Delete", danger: true, onSelect: () => void remove() },
  ];

  function changeProject(next: string) {
    const prev = draft!.projectId;
    if (next === prev) return;
    update((h) => {
      h.projectId = next;
    });
    toast({
      tone: "info",
      message: `Moved to "${projectName(next)}"`,
      action: {
        label: "Undo",
        onClick: () =>
          update((h) => {
            h.projectId = prev;
          }),
      },
    });
  }

  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        gridTemplateRows: "minmax(0, 1fr)",
        overflow: "hidden",
      }}
    >
      <PageChrome
        title="Hotcard"
        context={<NameInput value={draft.name} onChange={(v) => update((h) => { h.name = v; })} />}
        actions={
          <>
            <SaveBar
              dirty={dirty}
              saving={saving}
              onSave={() => void save()}
              onRevert={revert}
              disabledReason={connected ? undefined : "Reconnect to save"}
            />
            <IconButton aria-label={`More actions for ${draft.name}`} onClick={(e) => setMenuAnchor(e.currentTarget)}>
              <MoreHorizontal size={16} />
            </IconButton>
          </>
        }
      />
      {menuAnchor && <Menu items={menuItems} anchor={menuAnchor} onClose={() => setMenuAnchor(null)} />}

      <div style={{ overflow: "auto", padding: "16px 24px" }}>
        <div style={{ display: "flex", gap: 32, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 420px", maxWidth: 640, minWidth: 0, display: "grid", gap: 14 }}>
            <Field label="Template" layout="inline" labelWidth={110}>
              <TemplateSelect
                metas={templates}
                value={draft.templateId}
                onChange={(id) => update((h) => { h.templateId = id; })}
              />
            </Field>

            <Field label="F-key" layout="inline" labelWidth={110}>
              <HotkeySelect
                value={draft.hotkey ?? null}
                owners={hotkeyOwners(allHotcards, draft.projectId, draft.id)}
                onChange={(v) => update((h) => { h.hotkey = v; })}
              />
              {keyWarning && (
                <div role="alert" style={{ marginTop: 4, fontSize: fontSize.sm, color: colors.warn }}>
                  {keyWarning}
                </div>
              )}
            </Field>

            <Field label="Default output" layout="inline" labelWidth={110}>
              <ChannelHintSelect
                value={draft.channelHint}
                onChange={(v) => update((h) => { h.channelHint = v; })}
                channels={takeableChannels}
              />
              <div style={{ marginTop: 4, fontSize: fontSize.sm, color: colors.textDim }}>
                Cue always goes to Preview; Take goes here (Program if unset).
              </div>
            </Field>

            <Field label="Project" layout="inline" labelWidth={110}>
              <Select aria-label="Project" value={draft.projectId} onChange={(e) => changeProject(e.target.value)}>
                {!projects.some((p) => p.id === draft.projectId) && (
                  <option value={draft.projectId}>{draft.projectId}</option>
                )}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Notes" layout="inline" labelWidth={110}>
              <Input
                aria-label="Notes"
                value={draft.notes ?? ""}
                onChange={(e) => update((h) => { h.notes = e.target.value || undefined; })}
                placeholder="Optional note for operators"
              />
            </Field>

            <div>
              <h3 style={{ margin: "6px 0 8px", fontSize: fontSize.xs, fontWeight: 600, color: colors.textDim }}>
                Fields
              </h3>
              <FieldsEditor
                template={template}
                data={draft.data}
                onChange={(key, value) => update((h) => { h.data = { ...h.data, [key]: value }; })}
              />
            </div>
          </div>

          <div style={{ flex: `0 0 ${PREVIEW_WIDTH}px`, maxWidth: "100%" }}>
            <div style={{ fontSize: fontSize.xs, fontWeight: 600, color: colors.textDim, marginBottom: 8 }}>
              Preview
            </div>
            <div style={{ border: `1px solid ${colors.border}`, borderRadius: 6, overflow: "hidden", width: PREVIEW_WIDTH, maxWidth: "100%" }}>
              <TemplateThumbnail templateId={draft.templateId} data={draft.data} width={PREVIEW_WIDTH} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NameInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  return (
    <input
      aria-label="Hotcard name"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        background: "transparent",
        border: `1px solid ${focus ? colors.accent : hover ? colors.border : "transparent"}`,
        color: colors.text,
        fontSize: 15,
        fontWeight: 600,
        padding: "2px 6px",
        borderRadius: 4,
        width: 380,
        minWidth: 280,
        maxWidth: 480,
        outline: "none",
      }}
    />
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
  // Program and Preview aren't outputs a Take can default to: Cue always
  // goes to Preview, and Take goes to Program unless another output is set
  // (Default D7a). A legacy Program/Preview hint reads as unset.
  const outputs = channels.filter((c) => c.id !== "program" && c.id !== "preview");
  const current = value === "program" || value === "preview" ? "" : (value ?? "");
  const knownChannel = current && outputs.some((c) => c.id === current);
  return (
    <Select
      value={current}
      onChange={(e) => onChange(e.target.value ? e.target.value : undefined)}
    >
      <option value="">Program (default)</option>
      {!knownChannel && current && (
        <option value={current}>{current} (missing)</option>
      )}
      {outputs.map((c) => (
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
