"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import type { Show } from "@overlaysys/core";
import { useWs } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { AppHeader } from "@/app/components/AppHeader";

export default function ShowsIndexPage() {
  const router = useRouter();
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const showMetas = useStore((s) => s.showMetas);
  const [name, setName] = useState("");


  useEffect(() => {
    if (conn === "open") send({ type: "list_shows" });
  }, [conn, send]);

  function createShow() {
    const trimmed = name.trim();
    if (!trimmed || conn !== "open") return;
    const id = `show-${uuid().slice(0, 8)}`;
    const show: Show = { id, name: trimmed, rows: [] };
    send({ type: "save_show", show });
    setName("");
    setTimeout(() => router.push(`/shows/${id}`), 150);
  }

  function remove(id: string, name: string) {
    if (!confirm(`Delete show "${name}"? This removes the JSON file.`)) return;
    send({ type: "delete_show", showId: id });
  }

  return (
    <>
      <AppHeader />
      <main
        style={{
          overflow: "auto",
          padding: 24,
        }}
      >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>

        <section
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <h3 style={sectionH}>Create new show</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createShow()}
              placeholder="Show name (e.g., Friday Night Game)"
              style={input}
            />
            <button
              onClick={createShow}
              disabled={!name.trim() || conn !== "open"}
              style={primaryBtn}
            >
              Create
            </button>
          </div>
        </section>

        <h3 style={sectionH}>All shows</h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {showMetas.length === 0 && (
            <li style={{ color: "var(--text-dim)", fontSize: 13 }}>(none yet)</li>
          )}
          {showMetas.map((s) => (
            <li key={s.id} style={{ marginBottom: 4, display: "flex", gap: 4 }}>
              <Link
                href={`/shows/${s.id}`}
                style={{
                  flex: 1,
                  padding: "12px 14px",
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--text)",
                  textDecoration: "none",
                }}
              >
                <div style={{ fontWeight: 600 }}>{s.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                  {s.id} · {s.rowCount} {s.rowCount === 1 ? "row" : "rows"}
                </div>
              </Link>
              <button
                onClick={() => remove(s.id, s.name)}
                title="Delete show"
                style={delBtn}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
      </main>
    </>
  );
}

const sectionH: React.CSSProperties = {
  margin: 0,
  marginBottom: 8,
  fontSize: 11,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  color: "var(--text-dim)",
};
const input: React.CSSProperties = {
  flex: 1,
  padding: "8px 10px",
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text)",
  outline: "none",
};
const primaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
};
const delBtn: React.CSSProperties = {
  width: 44,
  background: "transparent",
  color: "var(--red)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 16,
};
