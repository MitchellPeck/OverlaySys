"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import { blankTemplate } from "@overlaysys/editor-kit";
import { useWs } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useDialog } from "@/lib/dialog";
import { downloadJson } from "@/lib/download";
import { AppHeader } from "@/app/components/AppHeader";

export default function DesignIndexPage() {
  const router = useRouter();
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const templates = useStore((s) => s.templates);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useDialog();

  useEffect(() => {
    if (conn === "open") send({ type: "list_templates" });
  }, [conn, send]);

  function createNew() {
    if (busy) return;
    setBusy(true);
    const id = `template-${uuid().slice(0, 8)}`;
    const tpl = blankTemplate(id, "Untitled");
    send({ type: "save_template", template: tpl });
    // Navigate after a short tick so the server has the file by the time the
    // editor route fetches it; the route also gracefully retries on conn-open.
    setTimeout(() => {
      router.push(`/design/edit?id=${encodeURIComponent(id)}`);
    }, 150);
  }

  function exportTemplate(id: string) {
    const cached = useStore.getState().templateCache[id];
    if (cached) {
      downloadJson(`${id}.json`, cached);
      return;
    }
    if (conn !== "open") return;
    send({ type: "get_template", templateId: id });
    const start = Date.now();
    const tick = () => {
      const c = useStore.getState().templateCache[id];
      if (c) { downloadJson(`${id}.json`, c); return; }
      if (Date.now() - start > 2000) return;
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  }

  async function remove(templateId: string) {
    const ok = await confirm({
      title: "Delete template",
      message: (
        <>
          Delete <strong>{templateId}</strong>? This removes the JSON file.
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) send({ type: "delete_template", templateId });
  }

  return (
    <>
      <AppHeader
        context={<h1 style={{ margin: 0, fontSize: 16 }}>Templates</h1>}
        actions={
          <button
            onClick={createNew}
            disabled={conn !== "open" || busy}
            style={{
              padding: "8px 14px",
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              fontWeight: 600,
              fontSize: 12,
              cursor: conn === "open" ? "pointer" : "not-allowed",
              opacity: conn === "open" ? 1 : 0.5,
            }}
          >
            + New template
          </button>
        }
      />
      <main style={{ padding: 24, maxWidth: 720 }}>

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {templates.length === 0 && (
          <li style={{ color: "var(--text-dim)", fontSize: 13 }}>(loading…)</li>
        )}
        {templates.map((t) => (
          <li key={t.id} style={{ marginBottom: 4, display: "flex", alignItems: "stretch", gap: 4 }}>
            <Link
              href={`/design/edit?id=${encodeURIComponent(t.id)}`}
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
              <div style={{ fontWeight: 600 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                {t.id} · {t.size.w}×{t.size.h}
              </div>
            </Link>
            <button
              onClick={() => exportTemplate(t.id)}
              title="Export template"
              style={{
                width: 44,
                background: "transparent",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              Export
            </button>
            <button
              onClick={() => remove(t.id)}
              title="Delete template"
              style={{
                width: 44,
                background: "transparent",
                color: "var(--red)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 16,
              }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      </main>
      {dialog}
    </>
  );
}
