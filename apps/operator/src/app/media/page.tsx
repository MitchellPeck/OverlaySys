"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaItemMeta } from "@overlaysys/core";
import { Button, LibraryList, offlineCopy, useConfirm, usePrompt, useToast, colors, radius } from "@overlaysys/ui";
import { useStore } from "../../lib/store";
import { getClient } from "../../lib/useWs";
import { useConnection } from "../../lib/useConnection";
import { deleteMediaItem, displayServerError, restoreMediaItem, saveMediaItem } from "../../lib/mediaRequests";
import { uploadAsset } from "../../lib/uploadAsset";
import { plural } from "../../lib/listFormat";
import { listLoadState } from "../../lib/listLoadState";
import { PageBody } from "../components/PageShell";
import { PageChrome } from "../shell/PageChrome";
import { LiveFolderDialog } from "./LiveFolderDialog";
import { MediaCard } from "./MediaCard";
import { buildImportedItem, mediaTypeOf, newMediaId, probeMedia } from "./importMedia";
import {
  DEFAULT_MEDIA_SORT,
  MEDIA_LIST_STORAGE_KEY,
  folderNames,
  mediaDeleteConfirm,
  mediaFilters,
  mediaMenuItems,
  mediaSorts,
  typeLabel,
  type MediaActions,
} from "./libraryConfig";

const ACCEPT = "image/*,video/*";
const searchText = (m: MediaItemMeta) => [m.name, m.folder ?? "", typeLabel(m)].join(" ");

export default function MediaLibraryPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const { connected, conn } = useConnection();
  const items = useStore((s) => s.mediaItems);
  const liveFolderFiles = useStore((s) => s.liveFolderFiles);
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveTarget, setLiveTarget] = useState<MediaItemMeta | undefined>();
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(0);
  const pickRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<MediaItemMeta | null>(null);
  // The media list has no loaded flag: empty + offline is the only error state.
  const load = listLoadState({ conn, loaded: true });

  useEffect(() => {
    if (connected) getClient().send({ type: "list_media" });
  }, [connected]);

  // Keep every live folder's file count fresh for its card.
  const liveIds = items.filter((m) => m.kind === "live-folder").map((m) => m.id).join(",");
  useEffect(() => {
    if (!connected) return;
    for (const id of liveIds.split(",").filter(Boolean)) getClient().send({ type: "list_live_folder", id });
  }, [connected, liveIds]);

  const filters = useMemo(() => mediaFilters(items), [items]);
  const folderKey = folderNames(items).join("\u0000");

  const failed = (e: unknown) => toast({ tone: "error", message: `Not saved: ${displayServerError(e)}` });

  const importFiles = async (files: File[]) => {
    const usable = files.filter((f) => mediaTypeOf(f.type));
    if (usable.length < files.length) toast({ tone: "error", message: "Only photos and videos can be added to Media." });
    if (usable.length === 0) return;
    setImporting((n) => n + usable.length);
    let added = 0;
    for (const file of usable) {
      try {
        const [upload, probe] = await Promise.all([uploadAsset(file), probeMedia(file)]);
        const item = buildImportedItem({ fileName: file.name, upload, id: newMediaId(), now: new Date().toISOString(), ...probe });
        if (!item) throw new Error("That file isn't a photo or video.");
        await saveMediaItem(item);
        added++;
      } catch (e) {
        toast({ tone: "error", message: `Couldn't add ${file.name}: ${displayServerError(e)}` });
      } finally {
        setImporting((n) => n - 1);
      }
    }
    if (added > 0) toast({ tone: "ok", message: added === 1 ? "Added to Media" : `Added ${added} files to Media` });
  };

  const replaceFile = async (file: File) => {
    const target = replaceTarget.current;
    replaceTarget.current = null;
    if (!target) return;
    try {
      const [upload, probe] = await Promise.all([uploadAsset(file), probeMedia(file)]);
      // Same type only; the server refuses a photo-for-video swap with a plain message.
      const next = { ...target, assetUrl: upload.url, mediaType: mediaTypeOf(upload.mime) ?? target.mediaType, ...probe };
      const { usedBy: _usedBy, ...item } = next;
      await saveMediaItem(item);
      toast({ tone: "ok", message: target.usedBy > 0 ? `Replaced. Updated ${plural(target.usedBy, "place")}.` : "File replaced" });
    } catch (e) {
      failed(e);
    }
  };

  const save = async (m: MediaItemMeta, patch: Partial<MediaItemMeta>) => {
    const { usedBy: _usedBy, ...item } = { ...m, ...patch };
    try {
      await saveMediaItem(item);
    } catch (e) {
      failed(e);
    }
  };

  const actions: MediaActions = {
    rename: async (m) => {
      const name = await prompt({ title: "Rename", defaultValue: m.name, confirmLabel: "Rename", required: true });
      const next = name?.trim();
      if (next && next !== m.name) await save(m, { name: next });
    },
    move: async (m) => {
      const known = folderNames(items);
      const answer = await prompt({
        title: "Move to folder",
        message: known.length ? `Existing folders: ${known.join(", ")}. Leave empty for no folder.` : "Name a folder. Leave empty for no folder.",
        defaultValue: m.folder ?? "",
        confirmLabel: "Move",
      });
      if (answer === null || answer === undefined) return;
      const folder = answer.trim();
      if (folder === (m.folder ?? "")) return;
      const { folder: _old, ...rest } = m;
      const { usedBy: _usedBy, ...item } = rest;
      try {
        await saveMediaItem(folder ? { ...item, folder } : item);
      } catch (e) {
        failed(e);
      }
    },
    replace: (m) => {
      replaceTarget.current = m;
      replaceRef.current?.click();
    },
    chooseFolder: (m) => {
      setLiveTarget(m);
      setLiveOpen(true);
    },
    delete: async (m) => {
      const ask = mediaDeleteConfirm(m);
      if (ask && !(await confirm(ask))) return;
      try {
        await deleteMediaItem(m.id);
      } catch (e) {
        failed(e);
        return;
      }
      toast({
        message: "Deleted from Media",
        action: { label: "Undo", onClick: () => void restoreMediaItem(m.id).catch(failed) },
      });
    },
  };

  const offline = !connected;
  const offlineReason = offline ? "Reconnect to edit Media" : undefined;
  const openAddLive = () => {
    setLiveTarget(undefined);
    setLiveOpen(true);
  };

  return (
    <PageBody variant="list">
      <PageChrome title="Media" />
      <div
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!offline) void importFiles([...e.dataTransfer.files]);
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          borderRadius: radius.lg,
          outline: dragging ? `2px dashed ${colors.brand}` : "none",
        }}
      >
        <LibraryList<MediaItemMeta>
          key={folderKey}
          items={items}
          getId={(m) => m.id}
          primary={(m) => m.name}
          secondary={(m) =>
            [typeLabel(m), m.folder, m.usedBy > 0 ? `Used by ${m.usedBy}` : null].filter(Boolean).join(" · ")
          }
          kind={() => "video"}
          searchText={searchText}
          sorts={mediaSorts}
          defaultSort={DEFAULT_MEDIA_SORT}
          filters={filters}
          menuItems={(m) => mediaMenuItems(m, actions, offlineReason)}
          onOpen={(m) => (m.kind === "live-folder" ? actions.chooseFolder(m) : actions.rename(m))}
          views={{ grid: { renderCard: (m) => <MediaCard item={m} liveFiles={liveFolderFiles[m.id]?.files} />, minCardWidth: 200 } }}
          headerActions={
            <Button variant="secondary" size="md" disabled={offline} onClick={openAddLive}>
              Add live folder
            </Button>
          }
          primaryAction={{
            label: importing > 0 ? "Importing…" : "Import media",
            onClick: () => pickRef.current?.click(),
            disabledReason: offline ? "Reconnect to import" : undefined,
          }}
          storageKey={MEDIA_LIST_STORAGE_KEY}
          emptyState={{
            title: "No media yet",
            body: "Drop photos and videos here, or add a live folder that plays whatever is in a folder on the show computer.",
            action: offline ? undefined : { label: "Import media", onClick: () => pickRef.current?.click() },
          }}
          loading={false}
          error={load.error && items.length === 0 ? offlineCopy("media").title : null}
        />
      </div>
      <input
        ref={pickRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          void importFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <input
        ref={replaceRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void replaceFile(f);
          e.target.value = "";
        }}
      />
      <LiveFolderDialog
        open={liveOpen}
        existing={liveTarget}
        onClose={() => setLiveOpen(false)}
        onError={(message) => toast({ tone: "error", message })}
      />
    </PageBody>
  );
}
