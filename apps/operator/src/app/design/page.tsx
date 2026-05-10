"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import { blankTemplate } from "@overlaysys/editor-kit";
import { Button, EntityList, EntityRow, IconButton, colors } from "@overlaysys/ui";
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
        title="Templates"
        actions={
          <Button
            onClick={createNew}
            disabled={conn !== "open" || busy}
            variant="primary"
            size="sm"
          >
            + New template
          </Button>
        }
      />
      <main style={{ padding: 24 }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          {templates.length === 0 ? (
            <p style={{ color: colors.textDim, fontSize: 13 }}>(loading…)</p>
          ) : (
            <EntityList>
              {templates.map((t) => (
                <EntityRow
                  key={t.id}
                  href={`/design/edit?id=${encodeURIComponent(t.id)}`}
                  primary={t.name}
                  secondary={`${t.id} · ${t.size.w}×${t.size.h}`}
                  actions={
                    <>
                      <Button onClick={() => exportTemplate(t.id)} size="sm" style={{ width: 64 }}>
                        Export
                      </Button>
                      <IconButton
                        onClick={() => remove(t.id)}
                        title="Delete template"
                        size={44}
                        style={{ color: colors.red, fontSize: 16, borderRadius: 6 }}
                      >
                        ×
                      </IconButton>
                    </>
                  }
                />
              ))}
            </EntityList>
          )}
        </div>
      </main>
      {dialog}
    </>
  );
}
