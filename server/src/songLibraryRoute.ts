import type { FastifyInstance } from "fastify";
import type { Show, Song } from "@overlaysys/core";
import { resolveShowDate, toISODate } from "@overlaysys/core";
import * as songs from "./songs";
import * as shows from "./shows";
import { broadcast } from "./broadcast";
import * as stageFeedHub from "./stageFeedHub";
import { scheduleSync } from "./cloudSync";
import { readSongUses, songUsesToCsv, summarizeSongUses } from "./songUsage";

/**
 * Song library routes for the operator's /songs page:
 *
 *  - `GET  /api/songs/library` — live songs with `updatedAt`, the number of
 *    shows using each, and flattened lyrics for client-side search; plus the
 *    tombstoned songs for the Recently Deleted view. HTTP rather than WS
 *    because the WS `song_list` schema is a fixed meta shape.
 *  - `POST /api/songs/:id/restore` — un-delete a tombstoned song.
 *  - `GET  /api/songs/ccli-report?from=YYYY-MM-DD&to=YYYY-MM-DD` — CSV of
 *    song uses (see songUsage.ts) for CCLI copy reporting. `to` is inclusive.
 */

export interface LibrarySong {
  id: string;
  title: string;
  author?: string;
  ccliNumber?: string;
  updatedAt?: string;
  createdAt?: string;
  /** YYYY-MM-DD of the latest dated show (on or before today) using this song. */
  lastUsed?: string;
  /** Live shows with at least one row for this song. */
  usedIn: number;
  /** Names of those shows (capped), for the delete warning. */
  usedInShows: string[];
  /** Section labels + lyrics, newline-joined, for search. */
  lyrics: string;
}

export interface DeletedSong {
  id: string;
  title: string;
  author?: string;
  ccliNumber?: string;
  deletedAt?: string;
  // [P3.20] lets the editor say "converted to deck …" for a tombstoned song
  customFields?: Record<string, string>;
  // [/P3.20]
}

export interface SongLibraryResponse {
  songs: LibrarySong[];
  deleted: DeletedSong[];
}

const USED_IN_NAMES_CAP = 5;

export function songLyricsText(song: Song): string {
  return song.sections.map((s) => [s.label, ...s.slides.flatMap((sl) => sl.lines)].join("\n")).join("\n");
}

export function buildSongLibrary(
  live: readonly Song[],
  deleted: readonly Song[],
  liveShows: readonly (Pick<Show, "name" | "rows"> & Partial<Pick<Show, "scheduledFor">>)[],
  today: string = toISODate(new Date()),
): SongLibraryResponse {
  const usage = new Map<string, string[]>();
  const lastUsed = new Map<string, string>();
  for (const show of liveShows) {
    const date = resolveShowDate({ name: show.name, scheduledFor: show.scheduledFor });
    const past = date !== null && date <= today ? date : null;
    if (past) {
      for (const row of show.rows) {
        if (row.kind !== "song") continue;
        const prev = lastUsed.get(row.songId);
        if (!prev || past > prev) lastUsed.set(row.songId, past);
      }
    }
    const ids = new Set<string>();
    for (const row of show.rows) if (row.kind === "song") ids.add(row.songId);
    for (const id of ids) {
      const list = usage.get(id) ?? [];
      list.push(show.name);
      usage.set(id, list);
    }
  }
  return {
    songs: live.map((s) => {
      const names = usage.get(s.id) ?? [];
      return {
        id: s.id,
        title: s.title,
        author: s.author,
        ccliNumber: s.ccliNumber,
        updatedAt: s.updatedAt,
        createdAt: s.createdAt,
        lastUsed: lastUsed.get(s.id),
        usedIn: names.length,
        usedInShows: names.slice(0, USED_IN_NAMES_CAP),
        lyrics: songLyricsText(s),
      };
    }),
    deleted: deleted.map((s) => ({
      id: s.id,
      title: s.title,
      author: s.author,
      ccliNumber: s.ccliNumber,
      deletedAt: s.deletedAt,
      customFields: s.customFields,
    })),
  };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse `from`/`to` (YYYY-MM-DD, local midnight; `to` inclusive). Null on bad input. */
export function parseReportRange(
  from: string | undefined,
  to: string | undefined,
): { from?: Date; to?: Date } | null {
  const out: { from?: Date; to?: Date } = {};
  if (from) {
    if (!DAY_RE.test(from)) return null;
    out.from = new Date(`${from}T00:00:00`);
  }
  if (to) {
    if (!DAY_RE.test(to)) return null;
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    out.to = end;
  }
  if (Object.values(out).some((d) => Number.isNaN(d.getTime()))) return null;
  return out;
}

async function loadLiveShows(): Promise<Show[]> {
  const metas = await shows.listShowMetas();
  const out: Show[] = [];
  for (const m of metas) {
    const s = await shows.getShow(m.id);
    if (s) out.push(s);
  }
  return out;
}

export async function registerSongLibraryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/songs/library", async (): Promise<SongLibraryResponse> => {
    const [live, deleted, liveShows] = await Promise.all([
      songs.listSongs(),
      songs.listDeletedSongs(),
      loadLiveShows(),
    ]);
    return buildSongLibrary(live, deleted, liveShows);
  });

  app.post<{ Params: { id: string } }>("/api/songs/:id/restore", async (req, reply) => {
    const restored = await songs.restoreSong(req.params.id);
    if (!restored) {
      reply.code(404);
      return { ok: false, error: "No deleted song with that id." };
    }
    broadcast({ type: "song", song: restored });
    broadcast({ type: "song_list", songs: await songs.listSongMetas() });
    stageFeedHub.invalidateAll();
    scheduleSync();
    return { ok: true, id: restored.id };
  });

  app.get<{ Querystring: { from?: string; to?: string } }>(
    "/api/songs/ccli-report",
    async (req, reply) => {
      const range = parseReportRange(req.query.from, req.query.to);
      if (!range) {
        reply.code(400);
        return { ok: false, error: "from/to must be YYYY-MM-DD" };
      }
      const csv = songUsesToCsv(summarizeSongUses(await readSongUses(range)));
      const name = `ccli-report-${req.query.from ?? "start"}-to-${req.query.to ?? "today"}.csv`;
      reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${name}"`);
      return csv;
    },
  );
}
