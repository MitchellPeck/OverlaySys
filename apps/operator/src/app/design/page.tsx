"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { v4 as uuid } from "uuid";
import { blankTemplate } from "@overlaysys/editor-kit";
import { Button, colors, radius } from "@overlaysys/ui";
import { useWs } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useDialog } from "@/lib/dialog";
import { downloadJson } from "@/lib/download";
import { ManagementList } from "@/app/components/ManagementList";
import { isCloudMode } from "@/lib/mode";
import { StageLayoutSchema } from "@overlaysys/core";
import type { StageLayoutMeta, TemplateMeta } from "@overlaysys/core";
import { channelsUsingLayout } from "@/lib/stageLayoutPicker";
import {
  deleteTemplateCloud,
  getTemplateCloud,
  refreshTemplateMetasCloud,
  saveTemplateCloud,
} from "@/lib/cloudData";

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
  const select = (t: "graphics" | "stage") => router.replace(t === "stage" ? "/design?tab=stage" : "/design");
  return (
    <>
      {!cloud && (
        <div style={{ display: "flex", gap: 0, padding: "12px 24px 0" }} role="tablist" aria-label="Design type">
          {(["graphics", "stage"] as const).map((t, i) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => select(t)}
              style={{
                padding: "6px 16px",
                fontSize: 13,
                cursor: "pointer",
                border: `1px solid ${colors.border}`,
                borderRadius: i === 0 ? `${radius.md}px 0 0 ${radius.md}px` : `0 ${radius.md}px ${radius.md}px 0`,
                marginLeft: i === 0 ? 0 : -1,
                background: tab === t ? colors.accent : "transparent",
                color: tab === t ? "#fff" : colors.text,
              }}
            >
              {t === "graphics" ? "Graphics" : "Stage layouts"}
            </button>
          ))}
        </div>
      )}
      {tab === "stage" ? <StageLayoutsList /> : <GraphicsList />}
    </>
  );
}

function StageLayoutsList() {
  const router = useRouter();
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const layouts = useStore((s) => s.stageLayouts);
  const channels = useStore((s) => s.channelConfigs);

  useEffect(() => {
    if (conn === "open") {
      send({ type: "list_stage_layouts" });
      send({ type: "list_channels" });
    }
  }, [conn, send]);

  async function createLayout(name: string): Promise<string> {
    const id = `stage-layout-${uuid().slice(0, 8)}`;
    send({ type: "save_stage_layout", layout: StageLayoutSchema.parse({ id, name, widgets: [] }) });
    return id;
  }

  return (
    <ManagementList<StageLayoutMeta>
      title="Stage layouts"
      entityNoun="stage layout"
      items={layouts}
      disabled={conn !== "open"}
      createFn={createLayout}
      onCreated={(id) => router.push(`/design/stage/edit?id=${encodeURIComponent(id)}`)}
      deleteFn={async (l) => {
        send({ type: "delete_stage_layout", layoutId: l.id });
      }}
      rowKey={(l) => l.id}
      rowHref={(l) => `/design/stage/edit?id=${encodeURIComponent(l.id)}`}
      rowPrimary={(l) => l.name}
      rowSecondary={(l) => `${l.size.w}×${l.size.h}${l.builtIn ? " · built-in" : ""}`}
      rowActions={(l) => (
        <Button
          onClick={() => send({ type: "duplicate_stage_layout", layoutId: l.id })}
          size="sm"
          style={{ width: 84 }}
          disabled={conn !== "open"}
        >
          Duplicate
        </Button>
      )}
      canDelete={(l) => !l.builtIn}
      cannotDeleteReason={() => "Built-in layouts can't be deleted"}
      deleteConfirmDetails={(l) => {
        const using = channelsUsingLayout(channels, l.id);
        return (
          <>
            {using.length > 0 && <>Used by: {using.map((c) => c.name || c.id).join(", ")}. </>}
            {using.length > 0 && <>They will fall back to Speaker.</>}
          </>
        );
      }}
      itemDisplayName={(l) => l.name || l.id}
      emptyMessage={<span style={{ color: colors.textDim, fontSize: 13 }}>(loading…)</span>}
    />
  );
}

function GraphicsList() {
  const router = useRouter();
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const templates = useStore((s) => s.templates);
  const { alert, dialog } = useDialog();
  const cloud = isCloudMode();
  const disabled = !cloud && conn !== "open";

  async function showError(action: string, err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.warn(`[design] cloud ${action} failed`, err);
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
    if (cloud) {
      refreshTemplateMetasCloud().catch((err) =>
        console.warn("[design] cloud list failed", err),
      );
    } else if (conn === "open") {
      send({ type: "list_templates" });
    }
  }, [cloud, conn, send]);

  async function createTemplate(name: string): Promise<string> {
    const id = `template-${uuid().slice(0, 8)}`;
    const tpl = { ...blankTemplate(id, name), name };
    if (cloud) {
      await saveTemplateCloud(tpl);
      await refreshTemplateMetasCloud();
      return id;
    }
    if (conn !== "open") throw new Error("WS not connected");
    send({ type: "save_template", template: tpl });
    return id;
  }

  async function duplicate(id: string) {
    if (cloud) {
      try {
        const src = await getTemplateCloud(id);
        if (!src) throw new Error("source template not found");
        const copyId = `template-${uuid().slice(0, 8)}`;
        // Editor-kit's blankTemplate isn't quite the right shape for a
        // full duplicate — just spread + new id + " (copy)" name.
        const copy = { ...src, id: copyId, name: `${src.name} (copy)` };
        await saveTemplateCloud(copy);
        await refreshTemplateMetasCloud();
      } catch (err) {
        await showError("duplicate", err);
      }
      return;
    }
    if (conn !== "open") return;
    send({ type: "duplicate_template", templateId: id });
  }

  async function exportTemplate(id: string) {
    if (cloud) {
      try {
        const t = await getTemplateCloud(id);
        if (t) downloadJson(`${id}.json`, t);
      } catch (err) {
        await showError("export", err);
      }
      return;
    }
    const cached = useStore.getState().templateCache[id];
    if (cached) {
      downloadJson(`${id}.json`, cached);
      return;
    }
    if (conn !== "open") return;
    send({ type: "get_template", templateId: id });
    const start = Date.now();
    const tick = () => {
      const c = useStore.getState().templateCache[id];
      if (c) { downloadJson(`${id}.json`, c); return; }
      if (Date.now() - start > 2000) return;
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  }

  async function deleteTemplate(t: TemplateMeta): Promise<void> {
    if (cloud) {
      await deleteTemplateCloud(t.id);
      await refreshTemplateMetasCloud();
      return;
    }
    send({ type: "delete_template", templateId: t.id });
  }

  return (
    <>
      <ManagementList<TemplateMeta>
        title="Templates"
        entityNoun="template"
        items={templates}
        disabled={disabled}
        createFn={createTemplate}
        onCreated={(id) => router.push(`/design/edit?id=${encodeURIComponent(id)}`)}
        deleteFn={deleteTemplate}
        rowKey={(t) => t.id}
        rowHref={(t) => `/design/edit?id=${encodeURIComponent(t.id)}`}
        rowPrimary={(t) => t.name}
        rowSecondary={(t) => `${t.id} · ${t.size.w}×${t.size.h}`}
        rowActions={(t) => (
          <>
            <Button onClick={() => duplicate(t.id)} size="sm" style={{ width: 84 }}>
              Duplicate
            </Button>
            <Button onClick={() => exportTemplate(t.id)} size="sm" style={{ width: 64 }}>
              Export
            </Button>
          </>
        )}
        itemDisplayName={(t) => t.name || t.id}
        emptyMessage={
          <span style={{ color: colors.textDim, fontSize: 13 }}>(loading…)</span>
        }
      />
      {dialog}
    </>
  );
}
