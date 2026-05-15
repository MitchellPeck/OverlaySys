"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import type { Hotcard, HotcardMeta } from "@overlaysys/core";
import { Button, colors } from "@overlaysys/ui";
import { useWs } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useDialog } from "@/lib/dialog";
import { ManagementList } from "@/app/components/ManagementList";
import { downloadJson } from "@/lib/download";
import { getCurrentProjectId } from "@/lib/currentProject";
import { isCloudMode } from "@/lib/mode";
import {
  deleteHotcardCloud,
  getHotcardCloud,
  refreshHotcardMetasCloud,
  refreshProjectsCloud,
  refreshTemplateMetasCloud,
  saveHotcardCloud,
} from "@/lib/cloudData";

export default function HotcardsIndexPage() {
  const router = useRouter();
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const allHotcards = useStore((s) => s.hotcards);
  const templates = useStore((s) => s.templates);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const projects = useStore((s) => s.projects);
  const { alert, dialog } = useDialog();
  const hotcards = allHotcards.filter((h) => h.projectId === currentProjectId);
  const currentProject = projects.find((p) => p.id === currentProjectId);
  const cloud = isCloudMode();
  const disabled = !cloud && conn !== "open";

  async function showError(action: string, err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.warn(`[hotcards] cloud ${action} failed`, err);
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
      Promise.all([
        refreshProjectsCloud(),
        refreshHotcardMetasCloud(),
        refreshTemplateMetasCloud(),
      ]).catch((err) => console.warn("[hotcards] cloud list failed", err));
    } else if (conn === "open") {
      send({ type: "list_hotcards" });
      send({ type: "list_templates" });
    }
  }, [cloud, conn, send]);

  async function createHotcard(name: string): Promise<string> {
    const firstTpl = templates[0]?.id;
    if (!firstTpl) {
      // No templates means an empty editor is useless — bail with a hint.
      router.push("/design");
      throw new Error("No templates exist yet — create one in Design first.");
    }
    const id = `hotcard-${uuid().slice(0, 8)}`;
    const hotcard: Hotcard = {
      id,
      name,
      projectId: getCurrentProjectId(),
      templateId: firstTpl,
      data: {},
    };
    if (cloud) {
      await saveHotcardCloud(hotcard);
      await refreshHotcardMetasCloud();
      return id;
    }
    if (conn !== "open") throw new Error("WS not connected");
    send({ type: "save_hotcard", hotcard });
    return id;
  }

  async function duplicate(id: string) {
    if (cloud) {
      try {
        const src = await getHotcardCloud(id);
        if (!src) throw new Error("source hotcard not found");
        const copyId = `hotcard-${uuid().slice(0, 8)}`;
        const copy: Hotcard = {
          ...src,
          id: copyId,
          name: `${src.name} (copy)`,
        };
        await saveHotcardCloud(copy);
        await refreshHotcardMetasCloud();
      } catch (err) {
        await showError("duplicate", err);
      }
      return;
    }
    if (conn !== "open") return;
    send({ type: "duplicate_hotcard", hotcardId: id });
  }

  async function exportHotcard(id: string) {
    if (cloud) {
      try {
        const h = await getHotcardCloud(id);
        if (h) downloadJson(`${id}.json`, h);
      } catch (err) {
        await showError("export", err);
      }
      return;
    }
    const cached = useStore.getState().hotcardCache[id];
    if (cached) {
      downloadJson(`${id}.json`, cached);
      return;
    }
    if (conn !== "open") return;
    send({ type: "get_hotcard", hotcardId: id });
    const start = Date.now();
    const tick = () => {
      const c = useStore.getState().hotcardCache[id];
      if (c) { downloadJson(`${id}.json`, c); return; }
      if (Date.now() - start > 2000) return;
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  }

  async function deleteHotcard(h: HotcardMeta): Promise<void> {
    if (cloud) {
      await deleteHotcardCloud(h.id);
      await refreshHotcardMetasCloud();
      return;
    }
    send({ type: "delete_hotcard", hotcardId: h.id });
  }

  async function moveToProject(id: string, nextProjectId: string) {
    if (cloud) {
      try {
        const src = await getHotcardCloud(id);
        if (!src) throw new Error("hotcard not found");
        await saveHotcardCloud({ ...src, projectId: nextProjectId });
        await refreshHotcardMetasCloud();
      } catch (err) {
        await showError("move", err);
      }
      return;
    }
    if (conn !== "open") return;
    const cached = useStore.getState().hotcardCache[id];
    if (cached) {
      send({
        type: "save_hotcard",
        hotcard: { ...cached, projectId: nextProjectId },
      });
      return;
    }
    send({ type: "get_hotcard", hotcardId: id });
    const start = Date.now();
    const tick = () => {
      const fresh = useStore.getState().hotcardCache[id];
      if (fresh) {
        send({
          type: "save_hotcard",
          hotcard: { ...fresh, projectId: nextProjectId },
        });
        return;
      }
      if (Date.now() - start > 2000) return;
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  }

  return (
    <>
      <ManagementList<HotcardMeta>
        title="Hotcards"
        entityNoun="hotcard"
        context={
          currentProject && (
            <span>
              in <strong style={{ color: "var(--text)" }}>{currentProject.name}</strong>
            </span>
          )
        }
        items={hotcards}
        disabled={disabled}
        createFn={createHotcard}
        onCreated={(id) => router.push(`/hotcards/edit?id=${encodeURIComponent(id)}`)}
        deleteFn={deleteHotcard}
        rowKey={(h) => h.id}
        rowHref={(h) => `/hotcards/edit?id=${encodeURIComponent(h.id)}`}
        rowPrimary={(h) => h.name}
        rowSecondary={(h) => {
          const tplName = templates.find((t) => t.id === h.templateId)?.name ?? h.templateId;
          return `${h.id} · ${tplName}`;
        }}
        rowActions={(h) => (
          <>
            {projects.length > 1 && (
              <select
                value={h.projectId}
                onChange={(e) => moveToProject(h.id, e.target.value)}
                title="Move to project"
                style={{
                  background: "var(--panel-2)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  padding: "3px 6px",
                  fontSize: 12,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <Button onClick={() => duplicate(h.id)} size="sm" style={{ width: 84 }}>
              Duplicate
            </Button>
            <Button onClick={() => exportHotcard(h.id)} size="sm" style={{ width: 64 }}>
              Export
            </Button>
          </>
        )}
        itemDisplayName={(h) => h.name || h.id}
        emptyMessage={
          <span style={{ color: colors.textDim, fontSize: 13 }}>
            No hotcards in this project yet. Hotcards are reusable graphics (titles,
            lower-thirds, stings, etc.) you can fire from the main rundown page without
            putting them in any specific show.
          </span>
        }
      />
      {dialog}
    </>
  );
}
