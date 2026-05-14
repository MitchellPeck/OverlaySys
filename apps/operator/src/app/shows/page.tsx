"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import type { Show } from "@overlaysys/core";
import { Button, EntityList, EntityRow, IconButton, colors } from "@overlaysys/ui";
import { useWs } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useDialog } from "@/lib/dialog";
import { AppHeader } from "@/app/components/AppHeader";
import { PageShell, PageBody } from "@/app/components/PageShell";
import { downloadJson } from "@/lib/download";
import { getCurrentProjectId } from "@/lib/currentProject";
import { isCloudMode } from "@/lib/mode";
import {
  deleteShowCloud,
  getShowCloud,
  refreshProjectsCloud,
  refreshShowMetasCloud,
  saveShowCloud,
} from "@/lib/cloudData";

export default function ShowsIndexPage() {
  const router = useRouter();
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const allShowMetas = useStore((s) => s.showMetas);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const projects = useStore((s) => s.projects);
  const { alert, confirm, dialog } = useDialog();
  const showMetas = allShowMetas.filter((s) => s.projectId === currentProjectId);
  const currentProject = projects.find((p) => p.id === currentProjectId);
  const cloud = isCloudMode();

  async function showError(action: string, err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.warn(`[shows] cloud ${action} failed`, err);
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
      // Cloud mode: pull project + show metadata from Supabase. Projects
      // come along because the move-to-project selector needs them.
      Promise.all([refreshProjectsCloud(), refreshShowMetasCloud()]).catch(
        (err) => console.warn("[shows] cloud list failed", err),
      );
    } else if (conn === "open") {
      send({ type: "list_shows" });
    }
  }, [cloud, conn, send]);

  async function newShow() {
    const id = `show-${uuid().slice(0, 8)}`;
    const show: Show = {
      id,
      name: "New Show",
      projectId: getCurrentProjectId(),
      rows: [],
    };
    if (cloud) {
      try {
        await saveShowCloud(show);
        await refreshShowMetasCloud();
        router.push(`/shows/edit?id=${encodeURIComponent(id)}`);
      } catch (err) {
        await showError("create", err);
      }
      return;
    }
    if (conn !== "open") return;
    send({ type: "save_show", show });
    setTimeout(() => router.push(`/shows/edit?id=${encodeURIComponent(id)}`), 150);
  }

  async function duplicate(id: string) {
    if (cloud) {
      // No server-side duplicate_show in cloud mode — replicate locally:
      // fetch, mint a new id, save as a copy.
      try {
        const src = await getShowCloud(id);
        if (!src) throw new Error("source show not found");
        const copyId = `show-${uuid().slice(0, 8)}`;
        const copy: Show = {
          ...src,
          id: copyId,
          name: `${src.name} (copy)`,
          rows: src.rows.map((r) => ({ ...r, id: uuid() })),
        };
        await saveShowCloud(copy);
        await refreshShowMetasCloud();
      } catch (err) {
        await showError("duplicate", err);
      }
      return;
    }
    if (conn !== "open") return;
    send({ type: "duplicate_show", showId: id });
  }

  async function exportShow(id: string) {
    if (cloud) {
      try {
        const show = await getShowCloud(id);
        if (show) downloadJson(`${id}.json`, show);
      } catch (err) {
        await showError("export", err);
      }
      return;
    }
    const cached = useStore.getState().showCache[id];
    if (cached) {
      downloadJson(`${id}.json`, cached);
      return;
    }
    if (conn !== "open") return;
    send({ type: "get_show", showId: id });
    const start = Date.now();
    const tick = () => {
      const c = useStore.getState().showCache[id];
      if (c) { downloadJson(`${id}.json`, c); return; }
      if (Date.now() - start > 2000) return;
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  }

  async function remove(id: string, name: string) {
    const ok = await confirm({
      title: "Delete show",
      message: (
        <>
          Delete <strong>{name}</strong>? This removes the JSON file.
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    if (cloud) {
      try {
        await deleteShowCloud(id);
        await refreshShowMetasCloud();
      } catch (err) {
        await showError("delete", err);
      }
      return;
    }
    send({ type: "delete_show", showId: id });
  }

  async function moveToProject(id: string, nextProjectId: string) {
    if (cloud) {
      try {
        const src = await getShowCloud(id);
        if (!src) throw new Error("show not found");
        await saveShowCloud({ ...src, projectId: nextProjectId });
        await refreshShowMetasCloud();
      } catch (err) {
        await showError("move", err);
      }
      return;
    }
    if (conn !== "open") return;
    // Re-fetch and re-save so the rest of the show payload comes along.
    // The store may already cache the show body — prefer that to avoid a
    // round-trip; fall back to requesting it then deferring the save.
    const cached = useStore.getState().showCache[id];
    if (cached) {
      send({ type: "save_show", show: { ...cached, projectId: nextProjectId } });
      return;
    }
    send({ type: "get_show", showId: id });
    const start = Date.now();
    const tick = () => {
      const fresh = useStore.getState().showCache[id];
      if (fresh) {
        send({
          type: "save_show",
          show: { ...fresh, projectId: nextProjectId },
        });
        return;
      }
      if (Date.now() - start > 2000) return;
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  }

  return (
    <PageShell>
      <AppHeader
        title="Shows"
        context={
          currentProject && (
            <span>
              in <strong style={{ color: "var(--text)" }}>{currentProject.name}</strong>
            </span>
          )
        }
        actions={
          <Button
            onClick={newShow}
            disabled={!cloud && conn !== "open"}
            variant="primary"
            size="sm"
          >
            + New Show
          </Button>
        }
      />
      <PageBody maxWidth={720}>
          {showMetas.length === 0 ? (
            <p style={{ color: colors.textDim, fontSize: 13 }}>
              No shows in this project yet. Create one to get started.
            </p>
          ) : (
            <EntityList>
              {showMetas.map((s) => (
                <EntityRow
                  key={s.id}
                  href={`/shows/edit?id=${encodeURIComponent(s.id)}`}
                  primary={s.name}
                  secondary={`${s.id} · ${s.rowCount} ${s.rowCount === 1 ? "row" : "rows"}`}
                  actions={
                    <>
                      {projects.length > 1 && (
                        <select
                          value={s.projectId}
                          onChange={(e) => moveToProject(s.id, e.target.value)}
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
                      <Button onClick={() => duplicate(s.id)} size="sm" style={{ width: 84 }}>
                        Duplicate
                      </Button>
                      <Button onClick={() => exportShow(s.id)} size="sm" style={{ width: 64 }}>
                        Export
                      </Button>
                      <IconButton
                        onClick={() => remove(s.id, s.name)}
                        title="Delete show"
                        size={44}
                        style={{ color: colors.red, fontSize: 16, borderRadius: 6 }}
                      >
                        ×
                      </IconButton>
                    </>
                  }
                />
              ))}
            </EntityList>
          )}
      </PageBody>
      {dialog}
    </PageShell>
  );
}
