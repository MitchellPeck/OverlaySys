"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { AppHeader } from "@/app/components/AppHeader";

export default function SongsPage() {
  const { send } = useWs();
  const songs = useStore((s) => s.songs);
  const conn = useStore((s) => s.conn);

  useEffect(() => {
    if (conn === "open") send({ type: "list_songs" });
  }, [conn, send]);

  function newSong() {
    const id = prompt("Song id (e.g. 'amazing-grace')?")?.trim();
    if (!id) return;
    const title = prompt("Title?", id)?.trim() ?? id;
    send({
      type: "save_song",
      song: {
        id,
        title,
        sections: [
          {
            id: "v1",
            kind: "verse",
            label: "Verse 1",
            slides: [{ id: "v1s1", lines: ["First line"] }],
          },
        ],
        defaultArrangement: ["v1"],
      },
    });
  }

  return (
    <>
      <AppHeader
        context={<h1 style={{ margin: 0, fontSize: 16 }}>Songs</h1>}
        actions={<button onClick={newSong} style={btn("primary")}>+ New Song</button>}
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
                  <Link href={`/songs/${encodeURIComponent(s.id)}`} style={{ fontWeight: 600 }}>
                    {s.title}
                  </Link>
                  <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "ui-monospace, monospace" }}>
                    {s.id}
                  </div>
                </td>
                <td style={td()}>{s.author ?? "—"}</td>
                <td style={td()}>{s.ccliNumber ?? "—"}</td>
                <td style={td()}>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${s.title}"?`)) {
                        send({ type: "delete_song", songId: s.id });
                      }
                    }}
                    style={btn()}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      </div>
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
