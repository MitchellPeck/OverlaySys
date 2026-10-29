"use client";

import {
  Suspense,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { convertedDeckId, type Song } from "@overlaysys/core";
import { Button, IconButton, SaveBar, colors, useContextMenu, useToast, type MenuItem } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { getClient, useWs } from "@/lib/useWs";
import { useDialog } from "@/lib/dialog";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { ackErrorText, sendAndAwaitAck } from "@/lib/awaitAck";
import { exportFileName } from "@/lib/exportName";
import { downloadJson } from "@/lib/download";
import { PageChrome } from "@/app/shell/PageChrome";
import { PasteLyricsModal } from "../PasteLyricsModal";
import { parsePastedLyrics, type SongPatch } from "../pasteLyrics";
import { parseSongImportJson } from "../songImport";
import { fetchSongLibrary, restoreDeletedSong } from "../libraryClient";
// [P3.20]
import { ConvertToDeckDialog } from "@/app/slides/ConvertToDeckDialog";
// [/P3.20]
import { SongDraftEditor } from "./SongDraftEditor";
import { decideIncomingSong, sameSongContent } from "./songDraftOps";
import { isSongNotFound } from "./songEditorModel";
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
  const router = useRouter();
  const id = decodeURIComponent(searchParams?.get("id") ?? "");
  const wantPaste = searchParams?.get("paste") === "1";
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const cached = useStore((s) => s.songCache[id]);
  const setSongInStore = useStore((s) => s.setSong);
  const templates = useStore((s) => s.templates);
  const [draft, setDraft] = useState<Song | null>(cached ?? null);
  /** Last version known to be on the server; `dirty` compares against it. */
  const [baseline, setBaseline] = useState<Song | null>(cached ?? null);
  /** A server copy that arrived while the draft had unsaved edits. */
  const [conflict, setConflict] = useState<Song | null>(null);
  /** One level of undo for "Paste lyrics": the draft before the paste. */
  const [pasteUndo, setPasteUndo] = useState<Song | null>(null);
  const [saving, setSaving] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(wantPaste);
  const [notFound, setNotFound] = useState(false);
  // [P3.20]
  const [convertOpen, setConvertOpen] = useState(false);
  // [/P3.20]
  /** Bumped to re-request the song (after a restore). */
  const [reloadKey, setReloadKey] = useState(0);
  const { alert, dialog } = useDialog();
  const toast = useToast();
  const more = useContextMenu();
  const fileInput = useRef<HTMLInputElement>(null);
  const cloud = isCloudMode();

  // Refs mirror state for the incoming-song effect and async save, which must
  // decide against the latest values, not a render snapshot.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  const dirty = !!draft && !!baseline && !sameSongContent(draft, baseline);
  const offline = !cloud && conn !== "open";

  // SongDraftEditor speaks React's setState shape so that several of its
  // updaters landing in one commit compose instead of clobbering each other.
  const updateDraft: Dispatch<SetStateAction<Song>> = (update) =>
    setDraft((d) => (d ? (typeof update === "function" ? update(d) : update) : d));

  useEffect(() => {
    if (!id) router.replace("/songs");
  }, [id, router]);

  useEffect(() => {
    if (!id) return;
    if (cloud) {
      if (!cached) {
        getSongCloud(id)
          .then((s) => {
            if (s) setSongInStore(s);
            else setNotFound(true);
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
  }, [cloud, conn, cached, id, send, templates.length, setSongInStore, reloadKey]);

  // The server answers get_song for an unknown (or deleted) id with not_found.
  useEffect(() => {
    if (cloud || !id) return;
    return getClient().on((msg) => {
      if (isSongNotFound(msg as { type: string; code?: string; message?: string }, id)) setNotFound(true);
    });
  }, [cloud, id]);

  // Every server copy of this song (load reply, our own save echo, another
  // client's save) lands in the store's songCache. Adopt it only when that
  // can't lose unsaved edits; otherwise raise the "changed elsewhere" banner.
  useEffect(() => {
    if (!cached) return;
    setNotFound(false);
    const decision = decideIncomingSong(
      { draft: draftRef.current, baseline: baselineRef.current },
      cached,
    );
    if (decision === "adopt") {
      setDraft(cached);
      setBaseline(cached);
      setConflict(null);
    } else if (decision === "rebase") {
      setBaseline(cached);
    } else {
      setConflict(cached);
    }
  }, [cached]);

  // Ask before leaving with unsaved changes: reload/close, in-app links and
  // browser Back/Forward.
  useUnsavedGuard(dirty, { resetKey: id, canArm: draft?.id === id });

  if (!id) return null;
  if (notFound && !draft) {
    return (
      <>
        <PageChrome title="Song" />
        <SongNotFound
          id={id}
          cloud={cloud}
          onBack={() => router.push("/songs")}
          onRestored={() => {
            setNotFound(false);
            setReloadKey((k) => k + 1);
          }}
        />
      </>
    );
  }
  if (!draft) return <div style={{ padding: 24 }}>Loading…</div>;

  async function save() {
    const current = draftRef.current;
    if (!current || saving) return;
    if (cloud) {
      setSaving(true);
      try {
        await saveSongCloud(current);
        await refreshSongMetasCloud();
        // Baseline first, so the store echo below reads as our own save.
        baselineRef.current = current;
        setBaseline(current);
        setSongInStore(current);
      } catch (err) {
        console.warn("[songs/edit] cloud save failed", err);
        toast({ message: `Not saved: ${ackErrorText(err)}`, tone: "error" });
      } finally {
        setSaving(false);
      }
      return;
    }
    setSaving(true);
    setConflict(null);
    try {
      await sendAndAwaitAck(getClient(), { type: "save_song", song: current }, { op: "save_song", id: current.id });
      // Ref too: the echo can be handled before the next render.
      baselineRef.current = current;
      setBaseline(current);
    } catch (e) {
      toast({ message: `Not saved: ${ackErrorText(e)}`, tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  function revert() {
    if (baselineRef.current) setDraft(baselineRef.current);
    setPasteUndo(null);
  }

  function reloadFromServer() {
    if (!conflict) return;
    setDraft(conflict);
    setBaseline(conflict);
    setConflict(null);
    setPasteUndo(null);
  }

  function keepMine() {
    // The server copy becomes the baseline so the draft stays dirty and the
    // next Save deliberately overwrites it.
    if (conflict) setBaseline(conflict);
    setConflict(null);
  }

  function applyPaste(patch: Partial<Song>) {
    setPasteUndo(draftRef.current);
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function undoPaste() {
    if (pasteUndo) setDraft(pasteUndo);
    setPasteUndo(null);
  }

  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const current = draftRef.current;
    if (!file || !current) return;
    const text = await file.text();
    let patch: SongPatch | null = null;
    if (text.trimStart().startsWith("{")) {
      const r = parseSongImportJson(text);
      if (!r.ok) {
        toast({ message: `Couldn't import ${file.name}: ${r.error}`, tone: "error" });
        return;
      }
      patch = { sections: r.song.sections, defaultArrangement: r.song.defaultArrangement };
    } else {
      const r = parsePastedLyrics(current, text, false, file.name);
      if (!r.ok) {
        toast({ message: `Couldn't import ${file.name}: ${r.error}`, tone: "error" });
        return;
      }
      patch = r.patch;
    }
    // Snapshot for this import's own Undo; the header's "Undo paste" state is left alone.
    const before = current;
    const applied = patch;
    setDraft((d) => (d ? { ...d, ...applied } : d));
    toast({
      message: `Imported ${file.name}`,
      action: { label: "Undo", onClick: () => setDraft(before) },
    });
  }

  const moreItems: MenuItem[] = [
    {
      id: "export",
      label: "Export",
      onSelect: () => downloadJson(exportFileName("song", draft), draft),
    },
    {
      id: "import",
      label: "Import from file…",
      onSelect: () => fileInput.current?.click(),
    },
    // [P3.20]
    {
      id: "convert-to-deck",
      label: "Convert to slide deck…",
      disabled: cloud
        ? "Not available in cloud mode"
        : offline
          ? "Not connected"
          : dirty
            ? "Save your changes first"
            : false,
      onSelect: () => setConvertOpen(true),
    },
    // [/P3.20]
  ];

  return (
    <>
      <PageChrome
        docTitle={draft.title || "Untitled song"}
        actions={
          <>
            {pasteUndo && (
              <Button onClick={undoPaste} size="sm" variant="ghost" title="Restore the song from before the paste">
                Undo paste
              </Button>
            )}
            <Button onClick={() => setPasteOpen((v) => !v)} size="sm" aria-expanded={pasteOpen}>
              {pasteOpen ? "Close paste" : "Paste lyrics…"}
            </Button>
            <IconButton aria-label="More song actions" title="More song actions" onClick={(e) => more.open(e.currentTarget, moreItems)}>
              <MoreHorizontal size={16} aria-hidden />
            </IconButton>
            <SaveBar
              dirty={dirty}
              saving={saving}
              onSave={save}
              onRevert={revert}
              disabledReason={offline ? "Not connected" : undefined}
              revertMessage="Discard unsaved changes to this song?"
            />
          </>
        }
      />
      <input
        ref={fileInput}
        type="file"
        accept=".json,.txt,.cho,.chordpro,.pro,application/json,text/plain"
        onChange={importFile}
        hidden
      />
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {conflict && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderBottom: `1px solid ${colors.warn}`,
              fontSize: 13,
              flex: "none",
            }}
          >
            <span style={{ flex: 1 }}>
              This song was changed elsewhere while you have unsaved edits.
            </span>
            <Button size="sm" onClick={reloadFromServer}>Reload theirs</Button>
            <Button size="sm" variant="primary" onClick={keepMine}>Keep mine</Button>
          </div>
        )}
        {pasteOpen && (
          <div style={{ flex: "none", maxHeight: "55%", overflow: "auto", padding: 12, borderBottom: `1px solid ${colors.border}` }}>
            <PasteLyricsModal
              song={draft}
              onApply={applyPaste}
              onClose={() => setPasteOpen(false)}
            />
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0 }}>
          <SongDraftEditor draft={draft} onChange={updateDraft} layout="frame" />
        </div>
      </div>
      {more.menu}
      {dialog}
      {/* [P3.20] converts the saved copy; the menu item is disabled while dirty */}
      <ConvertToDeckDialog
        song={convertOpen ? (baseline ?? draft) : null}
        onClose={() => setConvertOpen(false)}
        onConverted={() => {
          // The song is now soft-deleted: drop every local copy (and with them the leave
          // guard) so Save can't resurrect it, and show the converted-to-deck view.
          draftRef.current = null;
          baselineRef.current = null;
          useStore.setState((st) => {
            const { [id]: _gone, ...rest } = st.songCache;
            return { songCache: rest };
          });
          setDraft(null);
          setBaseline(null);
          setConflict(null);
          setNotFound(true);
        }}
      />
      {/* [/P3.20] */}
    </>
  );
}

/**
 * Shown when the id names no song. Offers "Restore" when the song is in
 * Recently deleted (local mode only). P3.20 adds the converted-to-deck notice
 * here.
 */
function SongNotFound({
  id,
  cloud,
  onBack,
  onRestored,
}: {
  id: string;
  cloud: boolean;
  onBack(): void;
  onRestored(): void;
}) {
  const toast = useToast();
  const [deleted, setDeleted] = useState<{ id: string; title: string; deckId: string | null } | null>(null);
  // [P3.20] the deck this song was converted to
  const decks = useStore((s) => s.decks);
  const router = useRouter();
  // [/P3.20]
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (cloud) return;
    let alive = true;
    fetchSongLibrary().then((lib) => {
      const row = lib?.deleted.find((d) => d.id === id);
      if (alive && row) setDeleted({ id: row.id, title: row.title, deckId: convertedDeckId({ customFields: row.customFields ?? {} }) });
    }).catch((err) => console.warn("[songs/edit] recently-deleted lookup failed", err));
    return () => {
      alive = false;
    };
  }, [cloud, id]);

  async function restore() {
    if (!deleted) return;
    setRestoring(true);
    try {
      await restoreDeletedSong(deleted.id);
      toast({ message: `Restored “${deleted.title}”`, tone: "ok" });
      onRestored();
    } catch (e) {
      toast({ message: `Not restored: ${ackErrorText(e)}`, tone: "error" });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div role="alert" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
        {deleted?.deckId
          ? (() => {
              const name = decks.find((d) => d.id === deleted.deckId)?.name;
              return name ? `This song was converted to the deck “${name}”` : "This song was converted to a slide deck";
            })()
          : "This song doesn't exist (it may have been deleted)."}
      </h2>
      {deleted && !deleted.deckId && (
        <p style={{ margin: 0, fontSize: 13, color: colors.textDim }}>
          “{deleted.title}” is in Recently deleted.
        </p>
      )}
      {/* [P3.20] */}
      {deleted?.deckId && (
        <p style={{ margin: 0, fontSize: 13, color: colors.textDim }}>
          Restoring the song brings it back alongside the deck.
        </p>
      )}
      {/* [/P3.20] */}
      <div style={{ display: "flex", gap: 8 }}>
        {/* [P3.20] */}
        {deleted?.deckId && (
          <Button variant="primary" size="sm" onClick={() => router.push(`/slides/edit?id=${encodeURIComponent(deleted.deckId!)}`)}>
            Open deck
          </Button>
        )}
        {/* [/P3.20] */}
        {deleted && (
          <Button variant={deleted.deckId ? "secondary" : "primary"} size="sm" onClick={restore} disabled={restoring}>
            Restore
          </Button>
        )}
        <Button size="sm" onClick={onBack}>
          Back to songs
        </Button>
      </div>
    </div>
  );
}
