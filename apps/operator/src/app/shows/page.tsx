"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import type { Show } from "@overlaysys/core";
import { Button, EntityList, EntityRow, IconButton, colors } from "@overlaysys/ui";
import { useWs } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useDialog } from "@/lib/dialog";
import { AppHeader } from "@/app/components/AppHeader";
import { downloadJson } from "@/lib/download";

export default function ShowsIndexPage() {
  const router = useRouter();
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const showMetas = useStore((s) => s.showMetas);
  const { confirm, dialog } = useDialog();

  useEffect(() => {
    if (conn === "open") send({ type: "list_shows" });
  }, [conn, send]);

  function newShow() {
    if (conn !== "open") return;
    const id = `show-${uuid().slice(0, 8)}`;
    const show: Show = { id, name: "New Show", rows: [] };
    send({ type: "save_show", show });
    setTimeout(() => router.push(`/shows/edit?id=${encodeURIComponent(id)}`), 150);
  }

  function duplicate(id: string) {
    if (conn !== "open") return;
    send({ type: "duplicate_show", showId: id });
  }

  function exportShow(id: string) {
    const cached = useStore.getState().showCache[id];
    if (cached) {
      downloadJson(`${id}.json`, cached);
      return;
    }
    if (conn !== "open") return;
    send({ type: "get_show", showId: id });
    const start = Date.now();
    const tick = () => {
      const c = useStore.getState().showCache[id];
      if (c) { downloadJson(`${id}.json`, c); return; }
      if (Date.now() - start > 2000) return;
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  }

  async function remove(id: string, name: string) {
    const ok = await confirm({
      title: "Delete show",
      message: (
        <>
          Delete <strong>{name}</strong>? This removes the JSON file.
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) send({ type: "delete_show", showId: id });
  }

  return (
    <>
      <AppHeader
        title="Shows"
        actions={
          <Button onClick={newShow} disabled={conn !== "open"} variant="primary" size="sm">
            + New Show
          </Button>
        }
      />
      <main style={{ padding: 24 }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          {showMetas.length === 0 ? (
            <p style={{ color: colors.textDim, fontSize: 13 }}>
              No shows yet. Create one to get started.
            </p>
          ) : (
            <EntityList>
              {showMetas.map((s) => (
                <EntityRow
                  key={s.id}
                  href={`/shows/edit?id=${encodeURIComponent(s.id)}`}
                  primary={s.name}
                  secondary={`${s.id} · ${s.rowCount} ${s.rowCount === 1 ? "row" : "rows"}`}
                  actions={
                    <>
                      <Button onClick={() => duplicate(s.id)} size="sm" style={{ width: 84 }}>
                        Duplicate
                      </Button>
                      <Button onClick={() => exportShow(s.id)} size="sm" style={{ width: 64 }}>
                        Export
                      </Button>
                      <IconButton
                        onClick={() => remove(s.id, s.name)}
                        title="Delete show"
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
