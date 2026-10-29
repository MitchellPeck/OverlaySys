"use client";

import { useEffect, useMemo } from "react";
import { AlertTriangle, Copy, Download, FolderInput, Files, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { hotkeyConflicts, type Hotcard, type HotcardMeta } from "@overlaysys/core";
import { Kbd, LibraryList, Tooltip, colors, confirm, toast, type Column, type MenuItem } from "@overlaysys/ui";
import { getClient, useWs } from "@/lib/useWs";
import { ackErrorText, requestOne, sendAndAwaitAck } from "@/lib/awaitAck";
import { listLoadState } from "@/lib/listLoadState";
import { useStore } from "@/lib/store";
import { exportFileName } from "@/lib/exportName";
import { downloadJson } from "@/lib/download";
import { isCloudMode } from "@/lib/mode";
import { hotcardSorts, moveHotkey, outputLabel } from "./hotcardListModel";
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
  const hotcards = useMemo(() => allHotcards.filter((h) => h.projectId === currentProjectId), [allHotcards, currentProjectId]);
  const channelConfigs = useStore((s) => s.channelConfigs);
  const conflicts = useMemo(() => hotkeyConflicts(hotcards, currentProjectId), [hotcards, currentProjectId]);
  const cloud = isCloudMode();
  const hotcardsLoaded = useStore((s) => s.hotcardsLoaded);
  const load = listLoadState({ cloud, conn, loaded: hotcardsLoaded });
  const disabled = !cloud && conn !== "open";

  function showError(action: string, err: unknown) {
    console.warn(`[hotcards] cloud ${action} failed`, err);
    toast({ message: `Cloud ${action} failed: ${ackErrorText(err)}`, tone: "error" });
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
        showError("duplicate", err);
      }
      return;
    }
    try {
      // The ack carries the copy's id, so match on the op alone.
      await sendAndAwaitAck(getClient(), { type: "duplicate_hotcard", hotcardId: id }, { op: "duplicate_hotcard" });
    } catch (err) {
      toast({ message: `Not duplicated: ${ackErrorText(err)}`, tone: "error" });
    }
  }

  async function exportHotcard(id: string) {
    if (cloud) {
      try {
        const h = await getHotcardCloud(id);
        if (h) downloadJson(exportFileName("hotcard", h), h);
      } catch (err) {
        showError("export", err);
      }
      return;
    }
    const cached = useStore.getState().hotcardCache[id];
    if (cached) {
      downloadJson(exportFileName("hotcard", cached), cached);
      return;
    }
    if (conn !== "open") return;
    try {
      const c = await requestOne(getClient(), { type: "get_hotcard", hotcardId: id }, (m) =>
        m.type === "hotcard" && m.hotcard.id === id ? m.hotcard : undefined,
      );
      downloadJson(exportFileName("hotcard", c), c);
    } catch (err) {
      toast({ message: `Not exported: ${ackErrorText(err)}`, tone: "error" });
    }
  }

  async function deleteHotcard(h: HotcardMeta): Promise<void> {
    if (cloud) {
      try {
        await deleteHotcardCloud(h.id);
        await refreshHotcardMetasCloud();
      } catch (err) {
        console.warn("[hotcards] cloud delete failed", err);
        toast({ message: `Not deleted: ${ackErrorText(err)}`, tone: "error" });
      }
      return;
    }
    try {
      await sendAndAwaitAck(getClient(), { type: "delete_hotcard", hotcardId: h.id }, { op: "delete_hotcard", id: h.id });
    } catch (err) {
      toast({ message: `Not deleted: ${ackErrorText(err)}`, tone: "error" });
    }
  }

  /** Throws when the move did not happen. `hotkey` is the F-key the card carries into the target project. */
  async function moveToProject(id: string, nextProjectId: string, hotkey: HotcardMeta["hotkey"]): Promise<void> {
    if (cloud) {
      const src = await getHotcardCloud(id);
      if (!src) throw new Error("Hotcard not found.");
      await saveHotcardCloud({ ...src, projectId: nextProjectId, hotkey });
      await refreshHotcardMetasCloud();
      return;
    }
    const cached = useStore.getState().hotcardCache[id];
    const card =
      cached ??
      (await requestOne(getClient(), { type: "get_hotcard", hotcardId: id }, (m) =>
        m.type === "hotcard" && m.hotcard.id === id ? m.hotcard : undefined,
      ));
    await sendAndAwaitAck(
      getClient(),
      { type: "save_hotcard", hotcard: { ...card, projectId: nextProjectId, hotkey } },
      { op: "save_hotcard", id },
    );
  }

  const columns: Column<HotcardMeta>[] = useMemo(
    () => [
      {
        id: "key",
        label: "F-key",
        width: "64px",
        render: (h) => {
          const clash = h.hotkey ? conflicts[h.hotkey] : undefined;
          if (!h.hotkey) return <span style={{ color: colors.textDim }}>—</span>;
          return (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Kbd>{h.hotkey}</Kbd>
              {clash && (
                <Tooltip content={`${h.hotkey} is assigned to ${clash.length} cards in this project; only one fires`}>
                  <span aria-label="F-key conflict" style={{ display: "inline-flex", color: colors.warn }}>
                    <AlertTriangle size={14} aria-hidden />
                  </span>
                </Tooltip>
              )}
            </span>
          );
        },
      },
      {
        id: "output",
        label: "Output",
        width: "140px",
        render: (h) => outputLabel(h.channelHint, channelConfigs),
      },
      {
        id: "template",
        label: "Template",
        width: "200px",
        render: (h) => templates.find((t) => t.id === h.templateId)?.name ?? <span style={{ color: colors.warn }}>Missing template</span>,
      },
    ],
    [conflicts, templates, channelConfigs],
  );

  function newHotcard() {
    router.push("/hotcards/edit?new=1");
  }

  async function removeHotcard(h: HotcardMeta) {
    const ok = await confirm({
      title: `Delete ${h.name || "this hotcard"}?`,
      message: "This removes the hotcard. It can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await deleteHotcard(h);
  }

  async function moveWithUndo(h: HotcardMeta, target: { id: string; name: string }) {
    const from = projects.find((p) => p.id === h.projectId);
    const { hotkey, droppedFrom } = moveHotkey(h, target.id, allHotcards);
    try {
      await moveToProject(h.id, target.id, hotkey);
    } catch (err) {
      toast({ message: `Not moved: ${ackErrorText(err)}`, tone: "error" });
      return;
    }
    const undo = async () => {
      try {
        await moveToProject(h.id, from!.id, h.hotkey ?? null);
      } catch (err) {
        toast({ message: `Not moved back: ${ackErrorText(err)}`, tone: "error" });
      }
    };
    toast({
      message: droppedFrom ? `Moved to ${target.name}. ${droppedFrom} was removed: already used in ${target.name}` : `Moved to ${target.name}`,
      tone: "ok",
      action: from ? { label: "Undo", onClick: () => void undo() } : undefined,
    });
  }

  const offline = disabled ? "Not connected to the server" : false;
  const menuItems = (h: HotcardMeta): MenuItem[] => {
    const others = projects.filter((p) => p.id !== h.projectId);
    const items: MenuItem[] = [
      { id: "open", label: "Open", onSelect: () => router.push(`/hotcards/edit?id=${encodeURIComponent(h.id)}`) },
      { id: "duplicate", label: "Duplicate", icon: <Files size={14} />, disabled: offline, onSelect: () => void duplicate(h.id) },
      { id: "export", label: "Export", icon: <Download size={14} />, disabled: offline, onSelect: () => void exportHotcard(h.id) },
    ];
    if (others.length > 0) {
      items.push({ separator: true });
      for (const p of others) {
        items.push({
          id: `move-${p.id}`,
          label: `Move to ${p.name}`,
          icon: <FolderInput size={14} />,
          disabled: offline,
          onSelect: () => void moveWithUndo(h, p),
        });
      }
    }
    items.push(
      { separator: true },
      { id: "copy-id", label: "Copy id", icon: <Copy size={14} />, onSelect: () => { void navigator.clipboard?.writeText(h.id); toast({ message: "Id copied", tone: "ok" }); } },
      { id: "delete", label: "Delete", icon: <Trash2 size={14} />, danger: true, disabled: offline, onSelect: () => void removeHotcard(h) },
    );
    return items;
  };

  return (
    <LibraryList<HotcardMeta>
      items={hotcards}
      getId={(h) => h.id}
      primary={(h) => h.name || "Untitled hotcard"}
      kind={() => "graphic"}
      columns={columns}
      searchText={(h) => `${h.name} ${templates.find((t) => t.id === h.templateId)?.name ?? ""}`}
      sorts={hotcardSorts}
      defaultSort="key-asc"
      menuItems={menuItems}
      onOpen={(h) => router.push(`/hotcards/edit?id=${encodeURIComponent(h.id)}`)}
      primaryAction={{
        label: "New hotcard",
        onClick: newHotcard,
        disabledReason: disabled ? "Not connected to the server" : undefined,
      }}
      storageKey="hotcards"
      emptyState={{
        title: "No hotcards in this project",
        body: "Hotcards are reusable graphics you can take from the Live page with Cue / Take or F1–F12.",
        action: { label: "New hotcard", onClick: newHotcard },
      }}
      loading={load.loading}
      error={load.error ? "Not connected to the server" : null}
    />
  );
}
