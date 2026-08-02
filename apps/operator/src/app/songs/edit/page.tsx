"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { type Song } from "@overlaysys/core";
import { Button, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useDialog } from "@/lib/dialog";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { PasteLyricsModal } from "../PasteLyricsModal";
import { SongDraftEditor } from "./SongDraftEditor";
import { isCloudMode } from "@/lib/mode";
import {
  getSongCloud,
  refreshSongMetasCloud,
  refreshTemplateMetasCloud,
  saveSongCloud,
} from "@/lib/cloudData";

// useSearchParams suspends during static prerender; wrapping it in a
// Suspense boundary lets Next.js's static export complete (the inner
// page hydrates with the real query string at runtime).
export default function SongEditorPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <SongEditorPageInner />
    </Suspense>
  );
}

function SongEditorPageInner() {
  const searchParams = useSearchParams();
  const id = decodeURIComponent(searchParams?.get("id") ?? "");
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const cached = useStore((s) => s.songCache[id]);
  const setSongInStore = useStore((s) => s.setSong);
  const templates = useStore((s) => s.templates);
  const [draft, setDraft] = useState<Song | null>(cached ?? null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const { alert, dialog } = useDialog();
  const cloud = isCloudMode();

  async function showCloudError(action: string, err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.warn(`[songs/edit] cloud ${action} failed`, err);
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
      if (!cached) {
        getSongCloud(id)
          .then((s) => {
            if (s) {
              setSongInStore(s);
              setDraft(s);
            }
          })
          .catch((err) => console.warn("[songs/edit] cloud load failed", err));
      }
      if (templates.length === 0) {
        refreshTemplateMetasCloud().catch((err) =>
          console.warn("[songs/edit] template list failed", err),
        );
      }
      return;
    }
    if (conn === "open" && !cached) send({ type: "get_song", songId: id });
    if (conn === "open" && templates.length === 0) send({ type: "list_templates" });
  }, [cloud, conn, cached, id, send, templates.length, setSongInStore]);

  useEffect(() => {
    if (cached) setDraft(cached);
  }, [cached]);

  if (!draft) return <div style={{ padding: 24 }}>Loading…</div>;

  async function save() {
    if (!draft) return;
    if (cloud) {
      try {
        await saveSongCloud(draft);
        await refreshSongMetasCloud();
        setSongInStore(draft);
      } catch (err) {
        await showCloudError("save", err);
      }
      return;
    }
    send({ type: "save_song", song: draft });
  }

  return (
    <>
      <PageChrome
        context={
          <h1 style={{ margin: 0, fontSize: 16 }}>
            ♪ {draft.title || <span style={{ color: colors.textDim, fontStyle: "italic" }}>(untitled)</span>}
          </h1>
        }
        actions={
          <>
            <Button onClick={() => setPasteOpen((v) => !v)} size="sm">Paste lyrics…</Button>
            <Button onClick={save} variant="primary" size="sm">Save</Button>
          </>
        }
      />
      <PageBody maxWidth={1100} style={{ height: "100%" }}>
        {pasteOpen && (
          <PasteLyricsModal
            song={draft}
            onApply={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
            onClose={() => setPasteOpen(false)}
          />
        )}
        <SongDraftEditor draft={draft} onChange={setDraft} />
      </PageBody>
      {dialog}
    </>
  );
}
