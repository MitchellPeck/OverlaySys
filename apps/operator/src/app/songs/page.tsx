"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Button, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useDialog } from "@/lib/dialog";
import { ManagementList } from "@/app/components/ManagementList";
import { ImportFromFileModal } from "./ImportFromFileModal";
import { downloadJson } from "@/lib/download";
import type { Song } from "@overlaysys/core";
import { isCloudMode } from "@/lib/mode";
import {
  deleteSongCloud,
  getSongCloud,
  refreshSongMetasCloud,
  saveSongCloud,
} from "@/lib/cloudData";

export default function SongsPage() {
  const { send } = useWs();
  const router = useRouter();
  const songs = useStore((s) => s.songs);
  const conn = useStore((s) => s.conn);
  const { alert, confirm, dialog } = useDialog();
  const [importOpen, setImportOpen] = useState(false);
  const cloud = isCloudMode();
  const disabled = !cloud && conn !== "open";

  async function showError(action: string, err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.warn(`[songs] cloud ${action} failed`, err);
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
      refreshSongMetasCloud().catch((err) =>
        console.warn("[songs] cloud list failed", err),
      );
    } else if (conn === "open") {
      send({ type: "list_songs" });
    }
  }, [cloud, conn, send]);

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
    if (cloud) {
      await saveSongCloud(song);
      await refreshSongMetasCloud();
      return id;
    }
    if (conn !== "open") throw new Error("WS not connected");
    send({ type: "save_song", song });
    return id;
  }

  async function persistSong(song: Song): Promise<void> {
    if (cloud) {
      await saveSongCloud(song);
      await refreshSongMetasCloud();
      return;
    }
    send({ type: "save_song", song });
  }

  async function handleImportSubmit(song: Song) {
    try {
      if (song.ccliNumber) {
        const existing = songs.find(
          (s) => s.ccliNumber === song.ccliNumber && s.id !== song.id,
        );
        if (existing) {
          const replace = await confirm({
            title: "Song already exists",
            message: (
              <>
                A song with CCLI # <strong>{song.ccliNumber}</strong> already exists:{" "}
                <strong>{existing.title || existing.id}</strong>.
                <br />
                Click <strong>Replace</strong> to overwrite that song, or <strong>Cancel</strong> to import as a new copy.
              </>
            ),
            confirmLabel: "Replace",
            cancelLabel: "Import as new copy",
            destructive: true,
          });
          if (replace) {
            await persistSong({ ...song, id: existing.id });
          } else {
            const baseSlug = song.id;
            let n = 2;
            while (songs.some((s) => s.id === `${baseSlug}-${n}`)) n++;
            await persistSong({ ...song, id: `${baseSlug}-${n}` });
          }
          setImportOpen(false);
          return;
        }
      }
      await persistSong(song);
      setImportOpen(false);
    } catch (err) {
      await showError("import", err);
    }
  }

  async function exportSong(id: string) {
    if (cloud) {
      try {
        const song = await getSongCloud(id);
        if (song) downloadJson(`${id}.json`, song);
      } catch (err) {
        await showError("export", err);
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

  async function deleteSong(song: Song): Promise<void> {
    if (cloud) {
      await deleteSongCloud(song.id);
      await refreshSongMetasCloud();
      return;
    }
    send({ type: "delete_song", songId: song.id });
  }

  return (
    <>
      <ManagementList<Song>
        title="Songs"
        entityNoun="song"
        items={songs}
        disabled={disabled}
        secondaryActions={
          <Button
            onClick={() => setImportOpen(true)}
            disabled={disabled}
            size="sm"
          >
            Import from file…
          </Button>
        }
        createFn={createSong}
        onCreated={(id) => router.push(`/songs/edit?id=${encodeURIComponent(id)}`)}
        deleteFn={deleteSong}
        rowKey={(s) => s.id}
        rowHref={(s) => `/songs/edit?id=${encodeURIComponent(s.id)}`}
        rowPrimary={(s) => s.title || <em style={{ color: colors.textDim }}>(untitled)</em>}
        rowSecondary={(s) =>
          [
            s.id,
            s.author ? `by ${s.author}` : null,
            s.ccliNumber ? `CCLI ${s.ccliNumber}` : null,
          ].filter(Boolean).join(" · ")
        }
        rowActions={(s) => (
          <Button onClick={() => exportSong(s.id)} size="sm" style={{ width: 64 }}>
            Export
          </Button>
        )}
        itemDisplayName={(s) => s.title || s.id}
      />
      {importOpen && (
        <ImportFromFileModal
          existingIds={new Set(songs.map((s) => s.id))}
          onCancel={() => setImportOpen(false)}
          onSubmit={(song) => handleImportSubmit(song)}
        />
      )}
      {dialog}
    </>
  );
}
