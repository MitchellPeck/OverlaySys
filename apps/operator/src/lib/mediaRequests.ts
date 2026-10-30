import type { MediaItem } from "@overlaysys/core";
import { sendAndAwaitAck, type AckClient } from "./awaitAck";
import { httpBase } from "./pcoClient";
import { getClient } from "./useWs";

/** Server errors arrive as "Error: <message>"; show just the message. */
export function displayServerError(e: unknown): string {
  const text = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return text.replace(/^Error:\s*/, "") || "Something went wrong.";
}

export function saveMediaItem(item: MediaItem, client: AckClient = getClient()): Promise<void> {
  return sendAndAwaitAck(client, { type: "save_media_item", item }, { op: "save_media_item", id: item.id });
}

export function deleteMediaItem(id: string, client: AckClient = getClient()): Promise<void> {
  return sendAndAwaitAck(client, { type: "delete_media_item", id }, { op: "delete_media_item", id });
}

export function restoreMediaItem(id: string, client: AckClient = getClient()): Promise<void> {
  return sendAndAwaitAck(client, { type: "restore_media_item", id }, { op: "restore_media_item", id });
}

/** Ask the server for a live folder's current files; the answer lands in the store via useWs. */
export function requestLiveFolder(id: string, client: AckClient = getClient()): void {
  client.send({ type: "list_live_folder", id });
}

/** Set (or clear, with null) this machine's folder path. The server only accepts this from the local machine. */
export async function setLiveFolderPath(id: string, path: string | null): Promise<void> {
  const res = await fetch(`${httpBase()}/api/media-folders/${encodeURIComponent(id)}/path`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (res.status === 403) throw new Error("Choose the folder on the show computer.");
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Couldn't set the folder (${res.status}).`);
  }
}
