"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { templateFromStarter } from "@overlaysys/editor-kit";
import { LibraryList, Pill, alertDialog, SegmentedControl, colors, offlineCopy, useConfirm, usePrompt, useToast } from "@overlaysys/ui";
import type { StageLayout, StageLayoutMeta, Template, TemplateMeta } from "@overlaysys/core";
import { getClient, useWs } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useConnection } from "@/lib/useConnection";
import { downloadJson } from "@/lib/download";
import { isCloudMode } from "@/lib/mode";
import { ackErrorText, requestOne, sendAndAwaitAck } from "@/lib/awaitAck";
import { listLoadState } from "@/lib/listLoadState";
import { channelsUsingLayout } from "@/lib/stageLayoutPicker";
import { TemplateThumbnail } from "@/lib/thumbnails/TemplateThumbnail";
import { useTemplateBody } from "@/lib/thumbnails/useTemplateBody";
import { sampleData } from "@/lib/thumbnails/sampleData";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { copyText } from "@/app/shell/clipboard";
import {
  deleteTemplateCloud,
  getTemplateCloud,
  refreshTemplateMetasCloud,
  saveTemplateCloud,
} from "@/lib/cloudData";
import { PROTECTED_TEMPLATE_IDS, fetchTemplateUsage, templateDeleteConfirm } from "./edit/templateUsage";
import { NewTemplateDialog } from "./NewTemplateDialog";
import {
  DEFAULT_GRAPHICS_SORT,
  DEFAULT_STAGE_SORT,
  GRAPHICS_STORAGE_KEY,
  STAGE_STORAGE_KEY,
  formatSize,
  stageMenuItems,
  stageSorts,
  templateColumns,
  templateFilters,
  templateMenuItems,
  templateSecondary,
  templateSorts,
  usedByLabel,
  type DesignActions,
} from "./designListModel";

const templateHref = (id: string) => `/design/edit?id=${encodeURIComponent(id)}`;
const stageHref = (id: string) => `/design/stage/edit?id=${encodeURIComponent(id)}`;

export default function DesignIndexPage() {
  return (
    <Suspense fallback={null}>
      <DesignTabs />
    </Suspense>
  );
}

function DesignTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cloud = isCloudMode();
  const tab = !cloud && searchParams?.get("tab") === "stage" ? "stage" : "graphics";
  return (
    <PageBody variant="list">
      <PageChrome title="Designs" />
      {!cloud && (
        <div>
          <SegmentedControl
            aria-label="Design type"
            value={tab}
            options={[
              { value: "graphics", label: "Graphics" },
              { value: "stage", label: "Stage layouts" },
            ]}
            onChange={(t) => router.replace(t === "stage" ? "/design?tab=stage" : "/design")}
          />
        </div>
      )}
      {/* Keyed by tab so sort/filter/view prefs and search never leak between the two lists. */}
      {tab === "stage" ? <StageLayoutsList key="stage" /> : <GraphicsList key="graphics" />}
    </PageBody>
  );
}

/** A grid card thumbnail that fills the card width and shows the template with placeholder data. */
function GridThumb({ templateId }: { templateId: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const { template } = useTemplateBody(templateId);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setWidth(el.clientWidth);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const size = template?.size ?? { w: 16, h: 9 };
  const data = useMemo(() => (template ? sampleData(template) : {}), [template]);
  return (
    <div
      ref={box}
      style={{
        width: "100%",
        aspectRatio: `${size.w} / ${size.h}`,
        overflow: "hidden",
        borderRadius: 4,
        background: colors.surface2,
      }}
    >
      {width > 0 && <TemplateThumbnail templateId={templateId} data={data} width={width} />}
    </div>
  );
}

/** Body from the cache, the cloud, or the server. */
async function loadTemplate(id: string, cloud: boolean): Promise<Template> {
  const cached = useStore.getState().templateCache[id];
  if (cached) return cached;
  if (cloud) {
    const t = await getTemplateCloud(id);
    if (!t) throw new Error("Template not found.");
    return t;
  }
  return requestOne(getClient(), { type: "get_template", templateId: id }, (m) =>
    m.type === "template" && m.template.id === id ? m.template : undefined,
  );
}

function GraphicsList() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const { send } = useWs();
  const { connected, conn } = useConnection();
  const cloud = isCloudMode();
  const templates = useStore((s) => s.templates);
  const loaded = useStore((s) => s.templatesLoaded);
  const [newOpen, setNewOpen] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const load = listLoadState({ cloud, conn, loaded });

  useEffect(() => {
    if (cloud) {
      refreshTemplateMetasCloud()
        .then(() => setCloudError(null))
        .catch((err) => {
          console.warn("[design] cloud list failed", err);
          setCloudError(err instanceof Error ? err.message : String(err));
        });
    } else if (conn === "open") {
      send({ type: "list_templates" });
    }
  }, [cloud, conn, send]);

  const failed = (what: string, e: unknown) => toast({ tone: "error", message: `${what}: ${ackErrorText(e)}` });
  const columns = useMemo(() => templateColumns(), [templates]);

  async function persist(t: Template): Promise<void> {
    if (cloud) {
      await saveTemplateCloud(t);
      await refreshTemplateMetasCloud();
      return;
    }
    await sendAndAwaitAck(getClient(), { type: "save_template", template: t }, { op: "save_template", id: t.id });
  }

  const actions: DesignActions<TemplateMeta> = {
    open: (t) => router.push(templateHref(t.id)),
    copyId: (t) => void copyText(t.id),
    duplicate: async (t) => {
      try {
        if (cloud) {
          const src = await loadTemplate(t.id, true);
          await persist({ ...src, id: `template-${uuid().slice(0, 8)}`, name: `${src.name} (copy)` });
        } else {
          // The ack carries the copy's id, so match on the op alone.
          await sendAndAwaitAck(getClient(), { type: "duplicate_template", templateId: t.id }, { op: "duplicate_template" });
        }
        toast({ tone: "ok", message: "Template duplicated" });
      } catch (e) {
        failed("Not duplicated", e);
      }
    },
    rename: async (t) => {
      const name = await prompt({ title: "Rename template", defaultValue: t.name, confirmLabel: "Rename", required: true });
      const next = name?.trim();
      if (!next || next === t.name) return;
      try {
        const body = await loadTemplate(t.id, cloud);
        await persist({ ...body, name: next });
      } catch (e) {
        failed("Not renamed", e);
      }
    },
    export: async (t) => {
      try {
        const body = await loadTemplate(t.id, cloud);
        downloadJson(`${t.id}.json`, body);
      } catch (e) {
        failed("Not exported", e);
      }
    },
    delete: async (t) => {
      const name = t.name || "template";
      const usage =
        (cloud ? null : await fetchTemplateUsage(t.id)) ??
        (PROTECTED_TEMPLATE_IDS.includes(t.id)
          ? { shows: [], hotcards: [], songs: [], scriptureDefault: false, protected: true }
          : null);
      const ask = templateDeleteConfirm(name, usage);
      if (ask.blocked) {
        await alertDialog({ title: ask.title, message: ask.message, okLabel: ask.confirmLabel });
        return;
      }
      if (!(await confirm({ title: ask.title, message: ask.message, confirmLabel: ask.confirmLabel, danger: true }))) return;
      try {
        if (cloud) {
          await deleteTemplateCloud(t.id);
          await refreshTemplateMetasCloud();
        } else {
          await sendAndAwaitAck(getClient(), { type: "delete_template", templateId: t.id }, { op: "delete_template", id: t.id });
        }
        toast({ tone: "ok", message: "Template deleted" });
      } catch (e) {
        failed("Not deleted", e);
      }
    },
  };

  const createTemplate = async (name: string, starterId: string) => {
    const id = `template-${uuid().slice(0, 8)}`;
    try {
      await persist(templateFromStarter(starterId, id, name));
    } catch (e) {
      failed("Not created", e);
      return;
    }
    setNewOpen(false);
    router.push(templateHref(id));
  };

  const now = new Date();
  return (
    <>
      <LibraryList<TemplateMeta>
        items={templates}
        getId={(t) => t.id}
        primary={(t) => t.name}
        secondary={(t) => templateSecondary(t, now)}
        kind={() => "graphic"}
        columns={columns}
        searchText={(t) => t.name}
        sorts={templateSorts}
        defaultSort={DEFAULT_GRAPHICS_SORT}
        filters={templateFilters}
        menuItems={(t) => templateMenuItems(t, actions)}
        onOpen={actions.open}
        primaryAction={{
          label: "New template",
          onClick: () => setNewOpen(true),
          disabledReason: connected ? undefined : "Reconnect to create",
        }}
        views={{
          grid: { minCardWidth: 220, renderCard: (t) => <GridThumb templateId={t.id} /> },
        }}
        storageKey={GRAPHICS_STORAGE_KEY}
        emptyState={{
          title: "No templates yet",
          body: "Start from a starter: lower third, title card, lyric or scripture.",
          action: connected ? { label: "New template", onClick: () => setNewOpen(true) } : undefined,
        }}
        loading={load.loading}
        error={cloudError ? `Couldn't load templates: ${cloudError}` : load.error ? offlineCopy("templates").title : null}
      />
      <NewTemplateDialog open={newOpen} onCancel={() => setNewOpen(false)} onCreate={createTemplate} />
    </>
  );
}

function StageLayoutsList() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const { send } = useWs();
  const { connected, conn } = useConnection();
  const layouts = useStore((s) => s.stageLayouts);
  const loaded = useStore((s) => s.stageLayoutsLoaded);
  const channels = useStore((s) => s.channelConfigs);
  const load = listLoadState({ conn, loaded });

  useEffect(() => {
    if (conn === "open") {
      send({ type: "list_stage_layouts" });
      send({ type: "list_channels" });
    }
  }, [conn, send]);

  const failed = (what: string, e: unknown) => toast({ tone: "error", message: `${what}: ${ackErrorText(e)}` });

  const actions: DesignActions<StageLayoutMeta> = {
    open: (l) => router.push(stageHref(l.id)),
    copyId: (l) => void copyText(l.id),
    duplicate: async (l) => {
      try {
        // The ack carries the copy's id: open it.
        const copyId = await requestOne(
          getClient(),
          { type: "duplicate_stage_layout", layoutId: l.id },
          (m) => (m.type === "ack" && m.op === "duplicate_stage_layout" ? m.id : undefined),
        );
        if (copyId) router.push(stageHref(copyId));
      } catch (e) {
        failed("Not duplicated", e);
      }
    },
    rename: async (l) => {
      const name = await prompt({ title: "Rename stage layout", defaultValue: l.name, confirmLabel: "Rename", required: true });
      const next = name?.trim();
      if (!next || next === l.name) return;
      try {
        const layout: StageLayout = await requestOne(
          getClient(),
          { type: "get_stage_layout", layoutId: l.id },
          (m) => (m.type === "stage_layout" && m.layout.id === l.id ? m.layout : undefined),
        );
        await sendAndAwaitAck(
          getClient(),
          { type: "save_stage_layout", layout: { ...layout, name: next } },
          { op: "save_stage_layout", id: l.id },
        );
      } catch (e) {
        failed("Not renamed", e);
      }
    },
    delete: async (l) => {
      if (l.builtIn) return;
      const using = channelsUsingLayout(channels, l.id);
      const ok = await confirm({
        title: `Delete "${l.name || "stage layout"}"?`,
        message:
          using.length > 0
            ? `Used by ${using.map((c) => c.name || c.id).join(", ")}. They will fall back to Speaker. This can't be undone.`
            : "This can't be undone.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      try {
        await sendAndAwaitAck(getClient(), { type: "delete_stage_layout", layoutId: l.id }, { op: "delete_stage_layout", id: l.id });
        toast({ tone: "ok", message: "Stage layout deleted" });
      } catch (e) {
        failed("Not deleted", e);
      }
    },
  };

  const columns = useMemo(
    () => [
      { id: "size", label: "Size", width: "100px", render: (l: StageLayoutMeta) => formatSize(l.size) },
      {
        id: "used",
        label: "Used by",
        width: "220px",
        render: (l: StageLayoutMeta) => usedByLabel(channelsUsingLayout(channels, l.id)),
      },
    ],
    [channels],
  );

  return (
    <LibraryList<StageLayoutMeta>
      items={layouts}
      getId={(l) => l.id}
      primary={(l) => l.name}
      secondary={(l) =>
        l.builtIn ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {formatSize(l.size)}
            <Pill tone="dim">Built-in</Pill>
          </span>
        ) : (
          formatSize(l.size)
        )
      }
      columns={columns}
      searchText={(l) => l.name}
      sorts={stageSorts}
      defaultSort={DEFAULT_STAGE_SORT}
      menuItems={(l) => stageMenuItems(l, actions)}
      onOpen={actions.open}
      primaryAction={{
        label: "New stage layout",
        onClick: () => router.push("/design/stage/edit?new=1"),
        disabledReason: connected ? undefined : "Reconnect to create",
      }}
      storageKey={STAGE_STORAGE_KEY}
      emptyState={{
        title: "No stage layouts yet",
        body: "Stage layouts control what the stage display shows.",
        action: connected ? { label: "New stage layout", onClick: () => router.push("/design/stage/edit?new=1") } : undefined,
      }}
      loading={load.loading}
      error={load.error ? offlineCopy("stage layouts").title : null}
    />
  );
}
