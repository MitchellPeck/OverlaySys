"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Copy, CopyPlus, Download, FolderOpen, Layers, Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  LibraryList,
  colors,
  fontSize,
  toast,
  useConfirm,
  usePrompt,
  type Column,
  type MenuItem,
} from "@overlaysys/ui";
import type { Song } from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { getClient, useWs } from "@/lib/useWs";
import { useConnection } from "@/lib/useConnection";
import { listLoadState } from "@/lib/listLoadState";
import { isCloudMode } from "@/lib/mode";
import { downloadJson } from "@/lib/download";
import { ackErrorText, requestOne, sendAndAwaitAck } from "@/lib/awaitAck";
import { exportFileName } from "@/lib/exportName";
import { formatRelative, formatServiceDate, plural } from "@/lib/listFormat";
import { copyText } from "@/app/shell/clipboard";
import { PageChrome } from "@/app/shell/PageChrome";
import { PageBody } from "@/app/components/PageShell";
import {
  deleteSongCloud,
  getSongCloud,
  refreshSongMetasCloud,
  saveSongCloud,
} from "@/lib/cloudData";
import { ImportFromFileModal } from "./ImportFromFileModal";
import { CcliReportModal } from "./CcliReportModal";
// [P3.20]
import { ConvertToDeckDialog } from "../slides/ConvertToDeckDialog";
// [/P3.20]
import { addedAt, mergeLibrary, songSearchText, songSorts, type LibraryRow } from "./librarySearch";
import { fetchSongLibrary, restoreDeletedSong, type DeletedSongRow, type SongLibrary } from "./libraryClient";

const TRASH_NOTE = "Deleted songs are kept until you empty Recently deleted.";
const OFFLINE_REASON = "Not connected to the server";

function formatDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

const titleOf = (s: { title: string; id: string }) => s.title || s.id;

export default function SongsPage() {
  const { send } = useWs();
  const router = useRouter();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const songs = useStore((s) => s.songs);
  const songsLoaded = useStore((s) => s.songsLoaded);
  const { connected, conn } = useConnection();
  const [importOpen, setImportOpen] = useState(false);
  const [ccliOpen, setCcliOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [library, setLibrary] = useState<SongLibrary | null>(null);
  // [P3.20]
  const [convertSong, setConvertSong] = useState<Song | null>(null);
  // [/P3.20]
  const cloud = isCloudMode();
  const disabled = !connected;
  const load = listLoadState({ cloud, conn, loaded: songsLoaded });

  useEffect(() => {
    if (cloud) {
      refreshSongMetasCloud().catch((err) => console.warn("[songs] cloud list failed", err));
    } else if (conn === "open") {
      send({ type: "list_songs" });
    }
  }, [cloud, conn, send]);

  // Usage counts, dates, lyrics for search and the trash come from the local
  // server's library route; refetch whenever the WS list changes.
  useEffect(() => {
    if (cloud || conn !== "open") return;
    let cancelled = false;
    void fetchSongLibrary().then((lib) => {
      if (!cancelled) setLibrary(lib);
    });
    return () => {
      cancelled = true;
    };
  }, [cloud, conn, songs]);

  const rows = useMemo(() => mergeLibrary(songs, library?.songs ?? null), [songs, library]);
  const deleted = library?.deleted ?? [];
  const allIds = useMemo(
    () => new Set([...songs.map((s) => s.id), ...deleted.map((d) => d.id)]),
    [songs, deleted],
  );
  const now = new Date();

  const persistSong = useCallback(
    async (song: Song): Promise<void> => {
      if (cloud) {
        await saveSongCloud(song);
        await refreshSongMetasCloud();
        return;
      }
      await sendAndAwaitAck(getClient(), { type: "save_song", song }, { op: "save_song", id: song.id });
    },
    [cloud],
  );

  const loadSong = useCallback(
    async (id: string): Promise<Song | null> => {
      if (cloud) return getSongCloud(id);
      const cached = useStore.getState().songCache[id];
      if (cached) return cached;
      return requestOne(getClient(), { type: "get_song", songId: id }, (m) =>
        m.type === "song" && m.song.id === id ? m.song : undefined,
      );
    },
    [cloud],
  );

  async function createSong() {
    const name = await prompt({
      title: "New song",
      message: "Name this song:",
      placeholder: "Song title",
      confirmLabel: "Create",
    });
    const title = name?.trim();
    if (!title) return;
    const id = `song-${uuid().slice(0, 8)}`;
    const song: Song = {
      id,
      title,
      sections: [{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "v1s1", lines: [""] }] }],
      defaultArrangement: ["v1"],
      customFields: {},
    };
    try {
      await persistSong(song);
      router.push(`/songs/edit?id=${encodeURIComponent(id)}&paste=1`);
    } catch (err) {
      toast({ tone: "error", message: `Not saved: ${ackErrorText(err)}` });
    }
  }

  async function handleImportSubmit(song: Song) {
    // The modal resolved the id (Replace keeps the duplicate's id; anything
    // else is auto-suffixed), so this is a plain save.
    try {
      await persistSong(song);
      setImportOpen(false);
      toast({ tone: "ok", message: `Imported “${titleOf(song)}”` });
      router.push(`/songs/edit?id=${encodeURIComponent(song.id)}`);
    } catch (err) {
      toast({ tone: "error", message: `Not saved: ${ackErrorText(err)}` });
    }
  }

  async function exportSong(row: LibraryRow) {
    try {
      const song = await loadSong(row.id);
      if (song) downloadJson(exportFileName("song", song), song);
      else toast({ tone: "error", message: `Couldn't export “${titleOf(row)}”: song not found.` });
    } catch (err) {
      toast({ tone: "error", message: `Couldn't export “${titleOf(row)}”: ${ackErrorText(err)}` });
    }
  }

  async function duplicateSong(row: LibraryRow) {
    try {
      const song = await loadSong(row.id);
      if (!song) throw new Error("Song not found.");
      const id = `song-${uuid().slice(0, 8)}`;
      // Server-managed stamps are not copied; the server stamps the new song.
      const copy: Song = { ...song, id, title: `${titleOf(song)} (copy)` };
      delete copy.createdAt;
      delete copy.updatedAt;
      await persistSong(copy);
      router.push(`/songs/edit?id=${encodeURIComponent(id)}`);
    } catch (err) {
      toast({ tone: "error", message: `Not saved: ${ackErrorText(err)}` });
    }
  }

  async function refreshAfterRestore() {
    send({ type: "list_songs" });
    setLibrary(await fetchSongLibrary());
  }

  async function undoDelete(row: LibraryRow) {
    try {
      await restoreDeletedSong(row.id);
      await refreshAfterRestore();
    } catch (err) {
      toast({ tone: "error", message: `Couldn't restore “${titleOf(row)}”: ${ackErrorText(err)}` });
    }
  }

  async function deleteSong(row: LibraryRow) {
    const name = titleOf(row);
    const usedIn = row.usedIn ?? 0;
    const canRestore = !cloud && library !== null;
    if (usedIn > 0) {
      const names = row.usedInShows ?? [];
      const list = names.join(", ") + (usedIn > names.length ? ", …" : "");
      const ok = await confirm({
        title: "Delete song",
        message: `“${name}” is used in ${plural(usedIn, "show")}${names.length ? ` (${list})` : ""}. Those rundown items will show the song as missing.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
    } else if (!canRestore) {
      const ok = await confirm({
        title: "Delete song",
        message: `Delete “${name}”? This can't be undone.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      if (cloud) {
        await deleteSongCloud(row.id);
        await refreshSongMetasCloud();
        return;
      }
      await sendAndAwaitAck(getClient(), { type: "delete_song", songId: row.id }, { op: "delete_song", id: row.id });
      toast({
        message: `Deleted “${name}”`,
        action: { label: "Undo", onClick: () => void undoDelete(row) },
      });
    } catch (err) {
      toast({ tone: "error", message: `Not deleted: ${ackErrorText(err)}` });
    }
  }

  async function restoreFromTrash(d: DeletedSongRow, isLast: boolean) {
    try {
      await restoreDeletedSong(d.id);
      toast({ tone: "ok", message: `Restored “${titleOf(d)}”` });
      if (isLast) setTrashOpen(false);
      await refreshAfterRestore();
    } catch (err) {
      toast({ tone: "error", message: `Couldn't restore “${titleOf(d)}”: ${ackErrorText(err)}` });
    }
  }

  // [P3.20]
  async function startConvert(row: LibraryRow) {
    try {
      const song = await loadSong(row.id);
      if (song) setConvertSong(song);
      else toast({ tone: "error", message: `Couldn't convert “${titleOf(row)}”: song not found.` });
    } catch (err) {
      toast({ tone: "error", message: `Couldn't convert “${titleOf(row)}”: ${ackErrorText(err)}` });
    }
  }
  // [/P3.20]

  function openSong(r: LibraryRow) {
    router.push(`/songs/edit?id=${encodeURIComponent(r.id)}`);
  }

  const columns: Column<LibraryRow>[] = [
    { id: "author", label: "Author", width: "180px", render: (r) => r.author || "—" },
    { id: "ccli", label: "CCLI", width: "96px", render: (r) => r.ccliNumber || "—" },
    { id: "added", label: "Added", width: "110px", render: (r) => formatRelative(addedAt(r), now) || "—" },
    {
      id: "used",
      label: "Last used",
      width: "110px",
      render: (r) => (r.lastUsed ? formatServiceDate(r.lastUsed, now) || "—" : "—"),
    },
  ];

  const menuItems = (r: LibraryRow): MenuItem[] => [
    { id: "open", label: "Open", icon: <FolderOpen size={14} />, onSelect: () => openSong(r) },
    {
      id: "duplicate",
      label: "Duplicate",
      icon: <CopyPlus size={14} />,
      disabled: disabled ? OFFLINE_REASON : false,
      onSelect: () => void duplicateSong(r),
    },
    {
      id: "export",
      label: "Export…",
      icon: <Download size={14} />,
      disabled: disabled ? OFFLINE_REASON : false,
      onSelect: () => void exportSong(r),
    },
    // [P3.20]
    {
      id: "convert-to-deck",
      label: "Convert to slide deck…",
      icon: <Layers size={14} />,
      disabled: cloud ? "Not available in cloud mode" : disabled ? OFFLINE_REASON : false,
      onSelect: () => void startConvert(r),
    },
    // [/P3.20]
    { separator: true },
    { id: "copy-id", label: "Copy id", icon: <Copy size={14} />, onSelect: () => void copyText(r.id).then((ok) => toast(ok ? { tone: "ok", message: "Id copied" } : { tone: "error", message: "Couldn’t copy the id" })) },
    { separator: true },
    {
      id: "delete",
      label: "Delete…",
      icon: <Trash2 size={14} />,
      danger: true,
      disabled: disabled ? OFFLINE_REASON : false,
      onSelect: () => void deleteSong(r),
    },
  ];

  return (
    <>
      <PageChrome title="Songs" />
      <PageBody variant="list" style={{ height: "100%" }}>
        <LibraryList<LibraryRow>
          items={rows}
          getId={(r) => r.id}
          primary={titleOf}
          secondary={(r) => ((r.usedIn ?? 0) > 0 ? `Used in ${plural(r.usedIn ?? 0, "show")}` : undefined)}
          kind={() => "song"}
          columns={columns}
          searchText={songSearchText}
          sorts={songSorts}
          defaultSort="added-desc"
          menuItems={menuItems}
          onOpen={openSong}
          primaryAction={{
            label: "New song",
            onClick: () => void createSong(),
            disabledReason: disabled ? OFFLINE_REASON : undefined,
          }}
          headerActions={
            <>
              <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setImportOpen(true)}>
                Import from file…
              </Button>
              {!cloud && (
                <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setCcliOpen(true)}>
                  CCLI report…
                </Button>
              )}
              {!cloud && deleted.length > 0 && (
                <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setTrashOpen(true)}>
                  Recently deleted ({deleted.length})
                </Button>
              )}
            </>
          }
          storageKey="songs"
          emptyState={{
            title: "No songs yet",
            body: "Add a song, import a SongSelect or ChordPro file, or bring songs in from Planning Center.",
            action: { label: "New song", onClick: () => void createSong() },
          }}
          loading={load.loading}
          error={load.error ? "Not connected to the server. Retrying…" : null}
        />
      </PageBody>
      {importOpen && (
        <ImportFromFileModal
          existingIds={allIds}
          existingSongs={songs}
          onCancel={() => setImportOpen(false)}
          onSubmit={(song) => handleImportSubmit(song)}
        />
      )}
      {ccliOpen && <CcliReportModal onClose={() => setCcliOpen(false)} />}
      {/* [P3.20] */}
      <ConvertToDeckDialog song={convertSong} onClose={() => setConvertSong(null)} />
      {/* [/P3.20] */}
      {trashOpen && (
        <Dialog
          open
          onClose={() => setTrashOpen(false)}
          onCancel={() => setTrashOpen(false)}
          size="md"
          title="Recently deleted songs"
          footer={
            <Button onClick={() => setTrashOpen(false)} size="sm">
              Close
            </Button>
          }
        >
          <p style={{ fontSize: fontSize.sm, color: colors.textDim, margin: "0 0 8px" }}>{TRASH_NOTE}</p>
          {deleted.length === 0 ? (
            <p style={{ fontSize: fontSize.md, color: colors.textDim }}>Nothing in Recently deleted.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {deleted.map((d) => (
                <li
                  key={d.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    borderBottom: `1px solid ${colors.border}`,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: fontSize.md }}>{titleOf(d)}</div>
                    <div style={{ fontSize: fontSize.xs, color: colors.textMuted }}>
                      {[
                        d.author ? `by ${d.author}` : null,
                        d.ccliNumber ? `CCLI ${d.ccliNumber}` : null,
                        formatDate(d.deletedAt) ? `deleted ${formatDate(d.deletedAt)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => void restoreFromTrash(d, deleted.length === 1)} disabled={disabled}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      )}
    </>
  );
}
