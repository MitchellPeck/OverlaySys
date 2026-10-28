"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Button, Modal, Select, colors, useToast } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { getClient, useWs } from "@/lib/useWs";
import { useDialog } from "@/lib/dialog";
import { ManagementList } from "@/app/components/ManagementList";
import { ImportFromFileModal } from "./ImportFromFileModal";
import { CcliReportModal } from "./CcliReportModal";
import { downloadJson } from "@/lib/download";
import type { Song } from "@overlaysys/core";
import { isCloudMode } from "@/lib/mode";
import {
  deleteSongCloud,
  getSongCloud,
  refreshSongMetasCloud,
  saveSongCloud,
} from "@/lib/cloudData";
import {
  mergeLibrary,
  songMatches,
  sortLibrary,
  type LibraryRow,
  type LibrarySort,
} from "./librarySearch";
import { fetchSongLibrary, restoreDeletedSong, type SongLibrary } from "./libraryClient";

const SORT_KEY = "overlaysys.songs.sort";
const SAVE_ACK_TIMEOUT_MS = 8000;

function loadSort(): LibrarySort {
  try {
    return window.localStorage.getItem(SORT_KEY) === "recent" ? "recent" : "title";
  } catch {
    return "title";
  }
}

/** Send save_song and resolve on the server's ack; reject on error, disconnect or timeout. */
function saveSongAcked(song: Song): Promise<void> {
  const client = getClient();
  return new Promise((resolve, reject) => {
    let done = false;
    const cleanups: (() => void)[] = [];
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      for (const c of cleanups) c();
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error("The server didn't confirm the save.")), SAVE_ACK_TIMEOUT_MS);
    cleanups.push(() => clearTimeout(timer));
    cleanups.push(
      client.on((msg) => {
        if (msg.type === "ack" && msg.op === "save_song" && msg.id === song.id) finish();
        else if (msg.type === "error" && (msg.code === "handler_error" || msg.code === "bad_message"))
          finish(new Error(msg.message));
      }),
    );
    // onStatus reports the current status synchronously; any later change
    // away from "open" means the ack can no longer arrive on this socket.
    let first = true;
    const offStatus = client.onStatus((s) => {
      const wasFirst = first;
      first = false;
      if (s !== "open" && !(wasFirst && s === "connecting")) {
        finish(new Error("Disconnected from the server before the save was confirmed."));
      }
    });
    if (done) offStatus();
    else cleanups.push(offStatus);
    if (!done) client.send({ type: "save_song", song });
  });
}

function formatDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

export default function SongsPage() {
  const { send } = useWs();
  const router = useRouter();
  const toast = useToast();
  const songs = useStore((s) => s.songs);
  const conn = useStore((s) => s.conn);
  const { alert, dialog } = useDialog();
  const [importOpen, setImportOpen] = useState(false);
  const [ccliOpen, setCcliOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [library, setLibrary] = useState<SongLibrary | null>(null);
  const [sort, setSort] = useState<LibrarySort>("title");
  const cloud = isCloudMode();
  const disabled = !cloud && conn !== "open";

  useEffect(() => setSort(loadSort()), []);

  async function showError(action: string, err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.warn(`[songs] ${action} failed`, err);
    await alert({
      title: `${cloud ? "Cloud " : ""}${action} failed`,
      message: (
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, margin: 0 }}>
          {message}
        </pre>
      ),
    });
  }

  useEffect(() => {
    if (cloud) {
      refreshSongMetasCloud().catch((err) =>
        console.warn("[songs] cloud list failed", err),
      );
    } else if (conn === "open") {
      send({ type: "list_songs" });
    }
  }, [cloud, conn, send]);

  // Usage counts, edit dates, lyrics for search and the trash come from the
  // local server's library route; refetch whenever the WS list changes.
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

  const rows = useMemo(
    () => sortLibrary(mergeLibrary(songs, library?.songs ?? null), sort),
    [songs, library, sort],
  );
  const deleted = library?.deleted ?? [];
  const allIds = useMemo(
    () => new Set([...songs.map((s) => s.id), ...deleted.map((d) => d.id)]),
    [songs, deleted],
  );

  async function createSong(title: string): Promise<string> {
    const id = `song-${uuid().slice(0, 8)}`;
    const song: Song = {
      id,
      title,
      sections: [
        {
          id: "v1",
          kind: "verse",
          label: "Verse 1",
          slides: [{ id: "v1s1", lines: [""] }],
        },
      ],
      defaultArrangement: ["v1"],
      customFields: {},
    };
    await persistSong(song);
    return id;
  }

  async function persistSong(song: Song): Promise<void> {
    if (cloud) {
      await saveSongCloud(song);
      await refreshSongMetasCloud();
      return;
    }
    if (conn !== "open") throw new Error("Not connected to the server.");
    await saveSongAcked(song);
  }

  async function handleImportSubmit(song: Song) {
    // The modal resolved the id (Replace keeps the duplicate's id; anything
    // else is auto-suffixed), so this is a plain save.
    try {
      await persistSong(song);
      setImportOpen(false);
      toast({ tone: "ok", message: `Imported ${song.title || song.id}` });
      router.push(`/songs/edit?id=${encodeURIComponent(song.id)}`);
    } catch (err) {
      await showError("Import", err);
    }
  }

  async function exportSong(id: string) {
    if (cloud) {
      try {
        const song = await getSongCloud(id);
        if (song) downloadJson(`${id}.json`, song);
      } catch (err) {
        await showError("Export", err);
      }
      return;
    }
    const cached = useStore.getState().songCache[id];
    if (cached) {
      downloadJson(`${id}.json`, cached);
      return;
    }
    if (conn !== "open") return;
    send({ type: "get_song", songId: id });
    const start = Date.now();
    const tick = () => {
      const c = useStore.getState().songCache[id];
      if (c) { downloadJson(`${id}.json`, c); return; }
      if (Date.now() - start > 2000) return;
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  }

  async function deleteSong(meta: LibraryRow): Promise<void> {
    if (cloud) {
      await deleteSongCloud(meta.id);
      await refreshSongMetasCloud();
      return;
    }
    send({ type: "delete_song", songId: meta.id });
  }

  async function restore(id: string) {
    try {
      await restoreDeletedSong(id);
      setLibrary(await fetchSongLibrary());
    } catch (err) {
      await showError("Restore", err);
    }
  }

  return (
    <>
      <ManagementList<LibraryRow>
        title="Songs"
        entityNoun="song"
        items={rows}
        disabled={disabled}
        filter={songMatches}
        filterPlaceholder={
          library ? "Filter by title, author, CCLI # or lyrics…" : "Filter by title, author or CCLI #…"
        }
        toolbar={
          <Select
            value={sort}
            aria-label="Sort songs"
            onChange={(e) => {
              const next = e.target.value === "recent" ? "recent" : "title";
              setSort(next);
              try {
                window.localStorage.setItem(SORT_KEY, next);
              } catch {
                // preference just isn't remembered
              }
            }}
            style={{ width: "auto" }}
          >
            <option value="title">Title A–Z</option>
            <option value="recent">Recently edited</option>
          </Select>
        }
        secondaryActions={
          <>
            {!cloud && (
              <Button onClick={() => setCcliOpen(true)} size="sm" disabled={disabled}>
                CCLI report…
              </Button>
            )}
            {!cloud && deleted.length > 0 && (
              <Button onClick={() => setTrashOpen(true)} size="sm" disabled={disabled}>
                Recently deleted ({deleted.length})
              </Button>
            )}
            <Button
              onClick={() => setImportOpen(true)}
              disabled={disabled}
              size="sm"
            >
              Import from file…
            </Button>
          </>
        }
        createFn={createSong}
        onCreated={(id) => router.push(`/songs/edit?id=${encodeURIComponent(id)}`)}
        deleteFn={deleteSong}
        deleteNote={!cloud && library ? "You can restore it from Recently deleted." : undefined}
        deleteConfirmDetails={(s) =>
          s.usedIn ? (
            <span style={{ color: colors.warn }}>
              {`Used in ${s.usedIn} show${s.usedIn === 1 ? "" : "s"}`}
              {s.usedInShows?.length
                ? ` (${s.usedInShows.join(", ")}${s.usedIn > s.usedInShows.length ? ", …" : ""})`
                : ""}
              {". Those rundown rows will show the song as missing."}
            </span>
          ) : null
        }
        rowKey={(s) => s.id}
        rowHref={(s) => `/songs/edit?id=${encodeURIComponent(s.id)}`}
        rowPrimary={(s) => s.title || <em style={{ color: colors.textDim }}>(untitled)</em>}
        rowSecondary={(s) => {
          const edited = formatDate(s.updatedAt);
          return [
            s.author ? `by ${s.author}` : null,
            s.ccliNumber ? `CCLI ${s.ccliNumber}` : null,
            s.usedIn ? `in ${s.usedIn} show${s.usedIn === 1 ? "" : "s"}` : null,
            edited ? `edited ${edited}` : null,
          ].filter(Boolean).join(" · ") || " ";
        }}
        rowActions={(s) => (
          <Button onClick={() => exportSong(s.id)} size="sm" style={{ width: 64 }} aria-label={`Export ${s.title || s.id}`}>
            Export
          </Button>
        )}
        itemDisplayName={(s) => s.title || s.id}
      />
      {importOpen && (
        <ImportFromFileModal
          existingIds={allIds}
          existingSongs={songs}
          onCancel={() => setImportOpen(false)}
          onSubmit={(song) => handleImportSubmit(song)}
        />
      )}
      {ccliOpen && <CcliReportModal onClose={() => setCcliOpen(false)} />}
      {trashOpen && (
        <Modal
          open
          onClose={() => setTrashOpen(false)}
          onCancel={() => setTrashOpen(false)}
          size="md"
          title="Recently deleted songs"
          footer={<Button onClick={() => setTrashOpen(false)} size="sm">Close</Button>}
        >
          {deleted.length === 0 ? (
            <p style={{ fontSize: 13, color: colors.textDim }}>Nothing in Recently deleted.</p>
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
                    <div style={{ fontSize: 13 }}>{d.title || d.id}</div>
                    <div style={{ fontSize: 11, color: colors.textDim }}>
                      {[
                        d.author ? `by ${d.author}` : null,
                        d.ccliNumber ? `CCLI ${d.ccliNumber}` : null,
                        formatDate(d.deletedAt) ? `deleted ${formatDate(d.deletedAt)}` : null,
                      ].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => restore(d.id)} disabled={disabled}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
      {dialog}
    </>
  );
}
