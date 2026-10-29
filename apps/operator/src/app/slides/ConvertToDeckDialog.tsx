"use client";

import { useEffect, useRef, useState } from "react";
import type { DeckLicensing, Song } from "@overlaysys/core";
import type { ServerMessage } from "@overlaysys/ws-protocol";
import { Button, Checkbox, Dialog, Tooltip, colors, fontSize, radius, toast } from "@overlaysys/ui";
import { getClient } from "../../lib/useWs";
import { LicensingField } from "./LicensingField";
import { convertResultMessage, convertWarningsMessage, derivedLicensing, titleSlideBlocker } from "./convertCopy";

type Converted = Extract<ServerMessage, { type: "song_converted" }>;

const CONVERT_TIMEOUT_MS = 30_000;
const UNDO_TIMEOUT_MS = 15_000;

class ConvertError extends Error {
  /** Set when the server's rollback failed too: Undo with this id finishes the cleanup. */
  conversionId?: string;
}

/** Send convert_song_to_deck and wait for song_converted (or the failure for this song). */
function requestConvert(songId: string, titleSlide: boolean, licensing: DeckLicensing): Promise<Converted> {
  const client = getClient();
  return new Promise<Converted>((resolve, reject) => {
    if (client.getStatus() !== "open") {
      reject(new ConvertError("Not connected to the server."));
      return;
    }
    const offs: Array<() => void> = [];
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const off of offs) off();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new ConvertError("The server didn't confirm in time."))),
      CONVERT_TIMEOUT_MS,
    );
    // Rejects are deferred one tick so a song_convert_failed that follows its
    // handler_error (same send) can attach its conversionId first.
    let pendingError: ConvertError | null = null;
    offs.push(
      client.on((m) => {
        if (m.type === "song_converted") {
          finish(() => resolve(m));
        } else if (m.type === "song_convert_failed" && m.songId === songId) {
          const err = pendingError ?? new ConvertError(m.message);
          err.conversionId = m.conversionId;
          finish(() => reject(err));
        } else if (m.type === "error" && m.code === "not_found" && m.message === songId) {
          finish(() => reject(new ConvertError("This song no longer exists.")));
        } else if (m.type === "error" && m.code === "handler_error" && m.message.endsWith(`[song:${songId}]`)) {
          // The server tags its reply with the song id; other requests' errors are ignored.
          pendingError = new ConvertError(m.message.slice(0, m.message.lastIndexOf(" [song:")));
          setTimeout(() => finish(() => reject(pendingError!)), 50);
        }
      }),
      client.onStatus((s) => {
        if (s !== "open") finish(() => reject(new ConvertError("Disconnected before the server confirmed.")));
      }),
    );
    client.send({ type: "convert_song_to_deck", songId, titleSlide, licensing });
  });
}

/** Undo a conversion and toast the outcome. Module-level so a toast's Undo outlives the dialog. */
const undoInFlight = new Set<string>();

export function undoConversion(conversionId: string, title: string): void {
  if (undoInFlight.has(conversionId)) return;
  const client = getClient();
  if (client.getStatus() !== "open") {
    toast({ tone: "error", message: "Couldn't undo: not connected to the server." });
    return;
  }
  const offs: Array<() => void> = [];
  undoInFlight.add(conversionId);
  const finish = () => {
    undoInFlight.delete(conversionId);
    clearTimeout(timer);
    for (const off of offs) off();
  };
  const timer = setTimeout(() => {
    finish();
    toast({ tone: "error", message: "Couldn't undo: the server didn't confirm in time." });
  }, UNDO_TIMEOUT_MS);
  offs.push(
    client.on((m) => {
      if (m.type === "song_convert_undone" && m.conversionId === conversionId) {
        finish();
        toast({
          tone: m.skippedShows > 0 ? "warn" : "ok",
          message:
            `Restored “${title}”` +
            (m.skippedShows > 0
              ? ` · left ${m.skippedShows} show${m.skippedShows === 1 ? "" : "s"} alone because they were edited since`
              : ""),
        });
      } else if (m.type === "error" && m.code === "busy" && m.message.includes(conversionId)) {
        finish();
        toast({ tone: "warn", message: "Undo is already in progress." });
      } else if (
        m.type === "error" &&
        ((m.code === "not_found" && m.message === conversionId) ||
          (m.code === "handler_error" && m.message.endsWith(`[conversion:${conversionId}]`)))
      ) {
        finish();
        toast({
          tone: "error",
          message:
            m.code === "not_found"
              ? "Nothing to undo: this conversion was already undone."
              : `Couldn't undo: ${m.message.slice(0, m.message.lastIndexOf(" [conversion:"))}`,
          ...(m.code === "handler_error"
            ? { action: { label: "Try again", onClick: () => undoConversion(conversionId, title) } }
            : {}),
        });
      }
    }),
    client.onStatus((s) => {
      if (s !== "open") {
        finish();
        toast({ tone: "error", message: "Couldn't undo: disconnected from the server." });
      }
    }),
  );
  client.send({ type: "undo_convert_song", conversionId });
}

/**
 * "Convert to slide deck" confirmation. Creates a deck from the song's play
 * order, switches upcoming shows to it and moves the song to Recently deleted
 * (the server does the work; this collects licensing and the title-slide
 * choice, then toasts the result with Undo).
 */
export function ConvertToDeckDialog({
  song,
  onClose,
  onConverted,
}: {
  song: Song | null;
  onClose(): void;
  /** Called once the server has converted the song (before the toast), e.g. to leave the song's editor. */
  onConverted?(res: Converted): void;
}) {
  const converting = useRef(false);
  const [titleSlide, setTitleSlide] = useState(false);
  const [licensing, setLicensing] = useState<DeckLicensing | null>(null);
  const [busy, setBusy] = useState(false);
  const songId = song?.id;

  // Fresh form for every song the dialog opens on.
  useEffect(() => {
    if (!song) return;
    setTitleSlide(false);
    setLicensing(derivedLicensing(song));
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId]);

  if (!song) return null;
  const title = song.title || song.id;
  const noIntro = titleSlideBlocker(song);

  const convert = async () => {
    if (converting.current || !licensing) return;
    converting.current = true;
    setBusy(true);
    try {
      const res = await requestConvert(song.id, titleSlide && !noIntro, licensing);
      onConverted?.(res);
      onClose();
      toast({
        tone: "ok",
        message: convertResultMessage(res),
        action: { label: "Undo", onClick: () => undoConversion(res.conversionId, title) },
      });
      const warn = convertWarningsMessage(res.warnings);
      if (warn) toast({ tone: "warn", message: warn });
    } catch (e) {
      const err = e instanceof ConvertError ? e : new ConvertError(e instanceof Error ? e.message : String(e));
      onClose();
      toast({
        tone: "error",
        message: `Couldn't convert “${title}”: ${err.message}`,
        ...(err.conversionId
          ? { action: { label: "Undo", onClick: () => undoConversion(err.conversionId!, title) } }
          : {}),
      });
    } finally {
      converting.current = false;
      setBusy(false);
    }
  };

  const checkbox = (
    <Checkbox
      checked={titleSlide && !noIntro}
      onChange={setTitleSlide}
      disabled={!!noIntro || busy}
      label="Add a title slide using the song's intro design"
    />
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title="Convert to slide deck"
      size="sm"
      onConfirm={() => void convert()}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="md" disabled={busy || !licensing} onClick={() => void convert()}>
            {busy ? "Converting…" : "Convert"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ margin: 0, fontSize: fontSize.md, color: colors.textDim, lineHeight: 1.45 }}>
          Creates the deck “{title}” from this song's play order, switches upcoming shows that use it to the deck, and
          moves the song to Recently deleted.
        </p>
        {noIntro ? (
          <Tooltip content={noIntro} side="top">
            <span tabIndex={0} style={{ display: "inline-flex", alignSelf: "flex-start", borderRadius: radius.md, outline: "none" }}>
              {checkbox}
            </span>
          </Tooltip>
        ) : (
          checkbox
        )}
        <LicensingField value={licensing} onChange={setLicensing} />
      </div>
    </Dialog>
  );
}
