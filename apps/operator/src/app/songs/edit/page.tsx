"use client";

import {
  Suspense,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useSearchParams } from "next/navigation";
import { Music } from "lucide-react";
import { type Song } from "@overlaysys/core";
import { Button, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { getClient, useWs } from "@/lib/useWs";
import { useDialog } from "@/lib/dialog";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { PasteLyricsModal } from "../PasteLyricsModal";
import { SongDraftEditor } from "./SongDraftEditor";
import {
  SAVE_ACK_TIMEOUT_MS,
  decideIncomingSong,
  sameSongContent,
  type SaveStatus,
} from "./songDraftOps";
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
  /** Last version known to be on the server; `dirty` compares against it. */
  const [baseline, setBaseline] = useState<Song | null>(cached ?? null);
  /** A server copy that arrived while the draft had unsaved edits. */
  const [conflict, setConflict] = useState<Song | null>(null);
  /** One level of undo for "Paste lyrics": the draft before the paste. */
  const [pasteUndo, setPasteUndo] = useState<Song | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  const [pasteOpen, setPasteOpen] = useState(false);
  const { alert, dialog } = useDialog();
  const cloud = isCloudMode();

  // Refs mirror state for the WS listener and the incoming-song effect,
  // which must decide against the latest values, not a render snapshot.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;
  const savingRef = useRef<{ sent: Song; timer: ReturnType<typeof setTimeout> } | null>(null);

  const dirty = !!draft && !!baseline && !sameSongContent(draft, baseline);
  const canSave = !!draft && (cloud || conn === "open") && saveStatus.kind !== "saving";

  // SongDraftEditor speaks React's setState shape so that several of its
  // updaters landing in one commit compose instead of clobbering each other.
  // The page's draft is nullable until the song loads, so unwrap the editor's
  // update against the latest non-null draft rather than a render snapshot.
  const updateDraft: Dispatch<SetStateAction<Song>> = (update) =>
    setDraft((d) => (d ? (typeof update === "function" ? update(d) : update) : d));

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
            if (s) setSongInStore(s);
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

  // Every server copy of this song (load reply, our own save echo, another
  // client's save) lands in the store's songCache. Adopt it only when that
  // can't lose unsaved edits; otherwise raise the "changed elsewhere" banner.
  useEffect(() => {
    if (!cached) return;
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

  // Save acks. The server answers save_song with { ack, op: "save_song", id }
  // before broadcasting the echo; a failure comes back as a generic error.
  useEffect(() => {
    if (cloud) return;
    const off = getClient().on((msg) => {
      const pending = savingRef.current;
      if (!pending) return;
      if (msg.type === "ack" && msg.op === "save_song" && msg.id === pending.sent.id) {
        clearTimeout(pending.timer);
        savingRef.current = null;
        // Ref too: the echo can be handled before the next render.
        baselineRef.current = pending.sent;
        setBaseline(pending.sent);
        setSaveStatus({ kind: "saved", at: Date.now() });
      } else if (msg.type === "error" && (msg.code === "handler_error" || msg.code === "bad_message")) {
        clearTimeout(pending.timer);
        savingRef.current = null;
        setSaveStatus({ kind: "failed", reason: msg.message });
      }
    });
    return off;
  }, [cloud]);

  // A dropped socket mid-save means the ack can't arrive.
  useEffect(() => {
    if (cloud || conn === "open") return;
    const pending = savingRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    savingRef.current = null;
    setSaveStatus({ kind: "failed", reason: "Disconnected from the server before the save was confirmed." });
  }, [cloud, conn]);

  useEffect(() => () => {
    if (savingRef.current) clearTimeout(savingRef.current.timer);
  }, []);

  // Ask before leaving with unsaved changes: reload/close, in-app links and
  // browser Back/Forward.
  useUnsavedGuard(dirty, { resetKey: id, canArm: draft?.id === id });

  if (!draft) return <div style={{ padding: 24 }}>Loading…</div>;

  async function save() {
    const current = draftRef.current;
    if (!current || !canSave) return;
    if (cloud) {
      setSaveStatus({ kind: "saving" });
      try {
        await saveSongCloud(current);
        await refreshSongMetasCloud();
        // Baseline first, so the store echo below reads as our own save.
        baselineRef.current = current;
        setBaseline(current);
        setSongInStore(current);
        setSaveStatus({ kind: "saved", at: Date.now() });
      } catch (err) {
        setSaveStatus({ kind: "failed", reason: err instanceof Error ? err.message : String(err) });
        await showCloudError("save", err);
      }
      return;
    }
    if (conn !== "open") {
      setSaveStatus({ kind: "failed", reason: "Not connected to the server." });
      return;
    }
    const timer = setTimeout(() => {
      if (savingRef.current?.sent !== current) return;
      savingRef.current = null;
      setSaveStatus({ kind: "failed", reason: "The server didn't confirm the save." });
    }, SAVE_ACK_TIMEOUT_MS);
    savingRef.current = { sent: current, timer };
    setSaveStatus({ kind: "saving" });
    setConflict(null);
    send({ type: "save_song", song: current });
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

  const statusText =
    saveStatus.kind === "saving"
      ? "Saving…"
      : saveStatus.kind === "failed"
        ? `Save failed — ${saveStatus.reason}`
        : dirty
          ? "Unsaved changes"
          : saveStatus.kind === "saved"
            ? "Saved"
            : "";
  const statusColor =
    saveStatus.kind === "failed" ? colors.errorText : dirty ? colors.warn : colors.textDim;
  const offline = !cloud && conn !== "open";

  return (
    <>
      <PageChrome
        context={
          <h1 style={{ margin: 0, fontSize: 16 }}>
            <Music size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> {draft.title || <span style={{ color: colors.textDim, fontStyle: "italic" }}>(untitled)</span>}
          </h1>
        }
        actions={
          <>
            <span role="status" aria-live="polite" style={{ fontSize: 12, color: statusColor, marginRight: 4 }}>
              {offline ? "Offline — can't save" : statusText}
            </span>
            {pasteUndo && (
              <Button onClick={undoPaste} size="sm" title="Restore the song body from before the paste">
                Undo paste
              </Button>
            )}
            <Button onClick={() => setPasteOpen((v) => !v)} size="sm">{pasteOpen ? "Close paste" : "Paste lyrics…"}</Button>
            <Button
              onClick={save}
              variant="primary"
              size="sm"
              disabled={!canSave}
              title={offline ? "Not connected to the server" : undefined}
            >
              {saveStatus.kind === "saving" ? "Saving…" : "Save"}
            </Button>
          </>
        }
      />
      <PageBody maxWidth={1100} style={{ height: "100%" }}>
        {conflict && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              marginBottom: 12,
              border: `1px solid ${colors.warn}`,
              borderRadius: 6,
              fontSize: 13,
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
          <PasteLyricsModal
            song={draft}
            onApply={applyPaste}
            onClose={() => setPasteOpen(false)}
          />
        )}
        <SongDraftEditor draft={draft} onChange={updateDraft} />
      </PageBody>
      {dialog}
    </>
  );
}
