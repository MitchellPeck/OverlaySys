"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, FolderInput, Trash2, Files } from "lucide-react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import type { Show } from "@overlaysys/core";
import { LibraryList, confirm, prompt, toast, type Column, type MenuItem } from "@overlaysys/ui";
import { useWs } from "@/lib/useWs";
import { useStore, type ShowMeta } from "@/lib/store";
import { useDialog } from "@/lib/dialog";
import { exportFileName } from "@/lib/exportName";
import { formatDuration, formatRelative, formatServiceDate, plural } from "@/lib/listFormat";
import { matchesWhen, metaDate, showFilterWhenOptions, showListStatus, showSorts } from "./showListModel";
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
  const { alert } = useDialog();
  const showMetas = allShowMetas.filter((s) => s.projectId === currentProjectId);
  const currentProject = projects.find((p) => p.id === currentProjectId);
  const cloud = isCloudMode();
  const initialMetas = useRef(allShowMetas);
  const [cloudListed, setCloudListed] = useState(false);
  const listed = cloud ? cloudListed : allShowMetas !== initialMetas.current || initialMetas.current.length > 0;
  const status = showListStatus({ cloud, conn, listed });
  const disabled = !cloud && conn !== "open";

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
      Promise.all([refreshProjectsCloud(), refreshShowMetasCloud()])
        .catch((err) => console.warn("[shows] cloud list failed", err))
        .finally(() => setCloudListed(true));
    } else if (conn === "open") {
      send({ type: "list_shows" });
    }
  }, [cloud, conn, send]);

  async function createShow(name: string): Promise<string> {
    const id = `show-${uuid().slice(0, 8)}`;
    const show: Show = {
      id,
      name,
      projectId: getCurrentProjectId(),
      rows: [],
      songs: [],
    };
    if (cloud) {
      await saveShowCloud(show);
      await refreshShowMetasCloud();
      return id;
    }
    if (conn !== "open") throw new Error("WS not connected");
    send({ type: "save_show", show });
    return id;
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
        if (show) downloadJson(exportFileName("show", show), show);
      } catch (err) {
        await showError("export", err);
      }
      return;
    }
    const cached = useStore.getState().showCache[id];
    if (cached) {
      downloadJson(exportFileName("show", cached), cached);
      return;
    }
    if (conn !== "open") return;
    send({ type: "get_show", showId: id });
    const start = Date.now();
    const tick = () => {
      const c = useStore.getState().showCache[id];
      if (c) { downloadJson(exportFileName("show", c), c); return; }
      if (Date.now() - start > 2000) return;
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  }

  async function deleteShow(meta: ShowMeta): Promise<void> {
    if (cloud) {
      await deleteShowCloud(meta.id);
      await refreshShowMetasCloud();
      return;
    }
    send({ type: "delete_show", showId: meta.id });
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

  const columns: Column<ShowMeta>[] = useMemo(
    () => [
      { id: "date", label: "Date", width: "110px", render: (s) => { const d = metaDate(s); return d ? formatServiceDate(d, new Date()) : "—"; } },
      { id: "items", label: "Items", width: "64px", align: "right", render: (s) => s.rowCount },
      { id: "length", label: "Length", width: "72px", align: "right", render: (s) => (s.totalLengthSec ? formatDuration(s.totalLengthSec) : "—") },
      { id: "edited", label: "Edited", width: "120px", render: (s) => formatRelative(s.updatedAt, new Date()) || "—" },
    ],
    [],
  );
  const filters = useMemo(
    () => [
      {
        id: "when",
        label: "dates",
        options: showFilterWhenOptions,
        test: (s: ShowMeta, v: string) => matchesWhen(s, v, new Date()),
      },
    ],
    [],
  );

  async function newShow() {
    const name = await prompt({
      title: "New show",
      placeholder: "Show name",
      confirmLabel: "Create",
      required: true,
    });
    if (!name?.trim()) return;
    try {
      const id = await createShow(name.trim());
      router.push(`/shows/edit?id=${encodeURIComponent(id)}`);
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Could not create the show", tone: "error" });
    }
  }

  async function removeShow(s: ShowMeta) {
    const ok = await confirm({
      title: `Delete ${s.name || "this show"}?`,
      message: "This removes the show and its rundown. It can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await deleteShow(s);
  }

  async function moveWithUndo(s: ShowMeta, target: { id: string; name: string }) {
    const from = projects.find((p) => p.id === s.projectId);
    await moveToProject(s.id, target.id);
    toast({
      message: `Moved to ${target.name}`,
      tone: "ok",
      action: from ? { label: "Undo", onClick: () => void moveToProject(s.id, from.id) } : undefined,
    });
  }

  const menuItems = (s: ShowMeta): MenuItem[] => {
    const others = projects.filter((p) => p.id !== s.projectId);
    const items: MenuItem[] = [
      { id: "open", label: "Open", onSelect: () => router.push(`/shows/edit?id=${encodeURIComponent(s.id)}`) },
      { id: "duplicate", label: "Duplicate", icon: <Files size={14} />, disabled: disabled ? "Not connected to the server" : false, onSelect: () => void duplicate(s.id) },
      { id: "export", label: "Export", icon: <Download size={14} />, disabled: disabled ? "Not connected to the server" : false, onSelect: () => void exportShow(s.id) },
    ];
    if (others.length > 0) {
      items.push({ separator: true });
      for (const p of others) {
        items.push({
          id: `move-${p.id}`,
          label: `Move to ${p.name}`,
          icon: <FolderInput size={14} />,
          disabled: disabled ? "Not connected to the server" : false,
          onSelect: () => void moveWithUndo(s, p),
        });
      }
    }
    items.push(
      { separator: true },
      { id: "copy-id", label: "Copy id", icon: <Copy size={14} />, onSelect: () => void navigator.clipboard?.writeText(s.id) },
      { id: "delete", label: "Delete", icon: <Trash2 size={14} />, danger: true, disabled: disabled ? "Not connected to the server" : false, onSelect: () => void removeShow(s) },
    );
    return items;
  };

  return (
    <LibraryList<ShowMeta>
      items={showMetas}
      getId={(s) => s.id}
      primary={(s) => s.name || "Untitled show"}
      secondary={(s) => plural(s.rowCount, "item")}
      columns={columns}
      searchText={(s) => s.name}
      sorts={showSorts}
      defaultSort="date-desc"
      filters={filters}
      menuItems={menuItems}
      onOpen={(s) => router.push(`/shows/edit?id=${encodeURIComponent(s.id)}`)}
      primaryAction={{
        label: "New show",
        onClick: () => void newShow(),
        disabledReason: disabled ? "Not connected to the server" : undefined,
      }}
      storageKey="shows"
      emptyState={{
        title: "No shows yet",
        body: "A show is the rundown for one service. Create one here, or import a plan from Planning Center.",
        action: { label: "New show", onClick: () => void newShow() },
      }}
      loading={status.loading}
      error={status.error}
    />
  );
}
