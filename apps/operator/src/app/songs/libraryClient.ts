"use client";

import { httpBase } from "@/lib/pcoClient";
import type { LibraryRow } from "./librarySearch";

/** Client for server/src/songLibraryRoute.ts. */

export interface DeletedSongRow {
  id: string;
  title: string;
  author?: string;
  ccliNumber?: string;
  deletedAt?: string;
  customFields?: Record<string, string>; // [P3.20]
}

export interface SongLibrary {
  songs: LibraryRow[];
  deleted: DeletedSongRow[];
}

/** Null when the server doesn't offer the route (older build) or is unreachable. */
export async function fetchSongLibrary(): Promise<SongLibrary | null> {
  try {
    const res = await fetch(`${httpBase()}/api/songs/library`);
    if (!res.ok) return null;
    return (await res.json()) as SongLibrary;
  } catch {
    return null;
  }
}

export async function restoreDeletedSong(id: string): Promise<void> {
  const res = await fetch(`${httpBase()}/api/songs/${encodeURIComponent(id)}/restore`, { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Restore failed (${res.status})`);
  }
}

/** Fetch the CCLI usage CSV for an inclusive YYYY-MM-DD range. */
export async function fetchCcliReport(from: string, to: string): Promise<string> {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const res = await fetch(`${httpBase()}/api/songs/ccli-report?${qs.toString()}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Report failed (${res.status})`);
  }
  return res.text();
}
