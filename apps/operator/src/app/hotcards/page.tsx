"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import type { Hotcard } from "@overlaysys/core";
import { Button, EntityList, EntityRow, IconButton, colors } from "@overlaysys/ui";
import { useWs } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useDialog } from "@/lib/dialog";
import { AppHeader } from "@/app/components/AppHeader";
import { downloadJson } from "@/lib/download";

export default function HotcardsIndexPage() {
  const router = useRouter();
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const hotcards = useStore((s) => s.hotcards);
  const templates = useStore((s) => s.templates);
  const { confirm, dialog } = useDialog();

  useEffect(() => {
    if (conn === "open") {
      send({ type: "list_hotcards" });
      send({ type: "list_templates" });
    }
  }, [conn, send]);

  function newHotcard() {
    if (conn !== "open") return;
    const firstTpl = templates[0]?.id;
    if (!firstTpl) {
      // No templates means an empty editor is useless — bail with a hint.
      router.push("/design");
      return;
    }
    const id = `hotcard-${uuid().slice(0, 8)}`;
    const hotcard: Hotcard = {
      id,
      name: "New Hotcard",
      templateId: firstTpl,
      data: {},
    };
    send({ type: "save_hotcard", hotcard });
    setTimeout(
      () => router.push(`/hotcards/edit?id=${encodeURIComponent(id)}`),
      150,
    );
  }

  function duplicate(id: string) {
    if (conn !== "open") return;
    send({ type: "duplicate_hotcard", hotcardId: id });
  }

  function exportHotcard(id: string) {
    const cached = useStore.getState().hotcardCache[id];
    if (cached) {
      downloadJson(`${id}.json`, cached);
      return;
    }
    if (conn !== "open") return;
    send({ type: "get_hotcard", hotcardId: id });
    const start = Date.now();
    const tick = () => {
      const c = useStore.getState().hotcardCache[id];
      if (c) { downloadJson(`${id}.json`, c); return; }
      if (Date.now() - start > 2000) return;
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  }

  async function remove(id: string, name: string) {
    const ok = await confirm({
      title: "Delete hotcard",
      message: (
        <>
          Delete <strong>{name}</strong>? This removes the JSON file.
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) send({ type: "delete_hotcard", hotcardId: id });
  }

  return (
    <>
      <AppHeader
        title="Hotcards"
        actions={
          <Button onClick={newHotcard} disabled={conn !== "open"} variant="primary" size="sm">
            + New Hotcard
          </Button>
        }
      />
      <main style={{ padding: 24 }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          {hotcards.length === 0 ? (
            <p style={{ color: colors.textDim, fontSize: 13 }}>
              No hotcards yet. Hotcards are reusable graphics (titles, lower-thirds,
              stings, etc.) you can fire from the main rundown page without putting
              them in any specific show.
            </p>
          ) : (
            <EntityList>
              {hotcards.map((h) => {
                const tplName =
                  templates.find((t) => t.id === h.templateId)?.name ?? h.templateId;
                return (
                  <EntityRow
                    key={h.id}
                    href={`/hotcards/edit?id=${encodeURIComponent(h.id)}`}
                    primary={h.name}
                    secondary={`${h.id} · ${tplName}`}
                    actions={
                      <>
                        <Button onClick={() => duplicate(h.id)} size="sm" style={{ width: 84 }}>
                          Duplicate
                        </Button>
                        <Button onClick={() => exportHotcard(h.id)} size="sm" style={{ width: 64 }}>
                          Export
                        </Button>
                        <IconButton
                          onClick={() => remove(h.id, h.name)}
                          title="Delete hotcard"
                          size={44}
                          style={{ color: colors.red, fontSize: 16, borderRadius: 6 }}
                        >
                          ×
                        </IconButton>
                      </>
                    }
                  />
                );
              })}
            </EntityList>
          )}
        </div>
      </main>
      {dialog}
    </>
  );
}
