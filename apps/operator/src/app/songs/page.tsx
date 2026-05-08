"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useDialog } from "@/lib/dialog";
import { AppHeader } from "@/app/components/AppHeader";
import { ImportFromFileModal } from "./ImportFromFileModal";
import { downloadJson } from "@/lib/download";
import type { Song } from "@overlaysys/core";

export default function SongsPage() {
  const { send } = useWs();
  const router = useRouter();
  const songs = useStore((s) => s.songs);
  const conn = useStore((s) => s.conn);
  const { confirm, dialog } = useDialog();
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (conn === "open") send({ type: "list_songs" });
  }, [conn, send]);

  function newSong() {
    if (conn !== "open") return;
    const id = `song-${uuid().slice(0, 8)}`;
    send({
      type: "save_song",
      song: {
        id,
        title: "",
        sections: [
          {
            id: "v1",
            kind: "verse",
            label: "Verse 1",
            slides: [{ id: "v1s1", lines: [""] }],
          },
        ],
        defaultArrangement: ["v1"],
      },
    });
    setTimeout(() => router.push(`/songs/edit?id=${encodeURIComponent(id)}`), 150);
  }

  async function handleImportSubmit(song: Song) {
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
          send({ type: "save_song", song: { ...song, id: existing.id } });
        } else {
          // Import as new copy: suffix the slug numerically.
          const baseSlug = song.id;
          let n = 2;
          while (songs.some((s) => s.id === `${baseSlug}-${n}`)) n++;
          send({ type: "save_song", song: { ...song, id: `${baseSlug}-${n}` } });
        }
        setImportOpen(false);
        return;
      }
    }
    send({ type: "save_song", song });
    setImportOpen(false);
  }

  function exportSong(id: string) {
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

  async function removeSong(id: string, title: string) {
    const ok = await confirm({
      title: "Delete song",
      message: (
        <>
          Delete <strong>{title || id}</strong>? This removes the JSON file.
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) send({ type: "delete_song", songId: id });
  }

  return (
    <>
      <AppHeader
        context={<h1 style={{ margin: 0, fontSize: 16 }}>Songs</h1>}
        actions={
          <>
            <button onClick={() => setImportOpen(true)} disabled={conn !== "open"} style={btn()}>
              Import from file…
            </button>
            <button onClick={newSong} disabled={conn !== "open"} style={btn("primary")}>
              + New Song
            </button>
          </>
        }
      />
      <div style={{ padding: 24 }}>

      {songs.length === 0 ? (
        <p style={{ color: "var(--text-dim)" }}>No songs yet. Create one to get started.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "var(--text-dim)", textAlign: "left" }}>
              <th style={th()}>Title</th>
              <th style={th()}>Author</th>
              <th style={th()}>CCLI</th>
              <th style={th()}></th>
            </tr>
          </thead>
          <tbody>
            {songs.map((s) => (
              <tr key={s.id}>
                <td style={td()}>
                  <Link href={`/songs/edit?id=${encodeURIComponent(s.id)}`} style={{ fontWeight: 600 }}>
                    {s.title || <em style={{ color: "var(--text-dim)" }}>(untitled)</em>}
                  </Link>
                  <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "ui-monospace, monospace" }}>
                    {s.id}
                  </div>
                </td>
                <td style={td()}>{s.author ?? "—"}</td>
                <td style={td()}>{s.ccliNumber ?? "—"}</td>
                <td style={td()}>
                  <button onClick={() => exportSong(s.id)} style={btn()}>Export</button>
                  {" "}
                  <button onClick={() => removeSong(s.id, s.title)} style={btn()}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {importOpen && (
        <ImportFromFileModal
          existingIds={new Set(songs.map((s) => s.id))}
          onCancel={() => setImportOpen(false)}
          onSubmit={(song) => handleImportSubmit(song)}
        />
      )}
      </div>
      {dialog}
    </>
  );
}

function btn(kind: "default" | "primary" = "default"): React.CSSProperties {
  return {
    padding: "6px 10px",
    background: kind === "primary" ? "var(--accent)" : "var(--panel-2)",
    color: kind === "primary" ? "#fff" : "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 12,
  };
}
function th(): React.CSSProperties {
  return { padding: "6px 8px", borderBottom: "1px solid var(--border)", fontWeight: 500, fontSize: 11 };
}
function td(): React.CSSProperties {
  return { padding: "8px", borderBottom: "1px solid var(--border)" };
}
