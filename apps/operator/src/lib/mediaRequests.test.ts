import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem, MediaItemMeta } from "@overlaysys/core";
import type { ClientMessage, ServerMessage } from "@overlaysys/ws-protocol";
import type { AckClient } from "./awaitAck";
import { setLiveFolderPath, displayServerError, deleteMediaItem, restoreMediaItem, saveMediaItem } from "./mediaRequests";
import { useStore } from "./store";

const meta = (id: string, name: string, usedBy = 0): MediaItemMeta => ({ id, name, kind: "file", mediaType: "image", assetUrl: `/a/${id}.png`, createdAt: "x", usedBy });

beforeEach(() => useStore.setState({ mediaItems: [], liveFolderFiles: {} }));

describe("media store", () => {
  it("upsertMediaItem replaces by id and keeps sort by name", () => {
    const s = useStore.getState();
    s.setMediaItems([meta("b", "Beta"), meta("a", "alpha")]);
    useStore.getState().upsertMediaItem(meta("c", "Charlie"));
    useStore.getState().upsertMediaItem(meta("b", "Aardvark", 3));
    const items = useStore.getState().mediaItems;
    expect(items.map((i) => i.id)).toEqual(["b", "a", "c"]);
    expect(items[0]).toMatchObject({ name: "Aardvark", usedBy: 3 });
  });
  it("setLiveFolderFiles stores files per folder", () => {
    const f = { name: "a.png", mediaType: "image" as const, size: 1, mtimeMs: 1 };
    useStore.getState().setLiveFolderFiles("f1", [f], true);
    useStore.getState().setLiveFolderFiles("f2", [], false);
    expect(useStore.getState().liveFolderFiles).toEqual({ f1: { files: [f], configured: true }, f2: { files: [], configured: false } });
  });
});

function fake(status: "open" | "closed" = "open") {
  const listeners = new Set<(m: ServerMessage) => void>();
  const c = {
    send: vi.fn((_m: ClientMessage) => {}),
    on: (l: (m: ServerMessage) => void) => (listeners.add(l), () => void listeners.delete(l)),
    onStatus: () => () => {},
    getStatus: () => status as never,
    emit: (m: unknown) => listeners.forEach((l) => l(m as ServerMessage)),
  };
  return c satisfies AckClient;
}
const item = { id: "m1", name: "M", kind: "file", mediaType: "image", assetUrl: "/a.png", createdAt: "x" } as MediaItem;

describe("media requests", () => {
  it("saveMediaItem rejects when disconnected", async () => {
    const c = fake("closed");
    await expect(saveMediaItem(item, c)).rejects.toMatchObject({ code: "not_connected" });
    expect(c.send).not.toHaveBeenCalled();
  });
  it("saveMediaItem, deleteMediaItem and restoreMediaItem resolve on their ack", async () => {
    const c = fake();
    const p1 = saveMediaItem(item, c);
    expect(c.send).toHaveBeenLastCalledWith({ type: "save_media_item", item });
    c.emit({ type: "ack", op: "save_media_item", id: "m1" });
    await expect(p1).resolves.toBeUndefined();
    const p2 = deleteMediaItem("m1", c);
    expect(c.send).toHaveBeenLastCalledWith({ type: "delete_media_item", id: "m1" });
    c.emit({ type: "ack", op: "delete_media_item", id: "m1" });
    await expect(p2).resolves.toBeUndefined();
    const p3 = restoreMediaItem("m1", c);
    c.emit({ type: "ack", op: "restore_media_item", id: "m1" });
    await expect(p3).resolves.toBeUndefined();
  });
  it("displayServerError strips a leading Error: prefix", () => {
    expect(displayServerError("Error: Name taken")).toBe("Name taken");
    expect(displayServerError("Plain")).toBe("Plain");
    expect(displayServerError(new Error("Error: x"))).toBe("x");
  });
});

describe("setLiveFolderPath errors", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status < 400, status, json: async () => body })));
  it("shows the server message on a 400", async () => {
    stub(400, { message: "That folder doesn't exist." });
    await expect(setLiveFolderPath("f1", "/nope")).rejects.toThrow("That folder doesn't exist.");
  });
  it("shows friendly text on a 403", async () => {
    stub(403, { error: "only allowed from this machine" });
    await expect(setLiveFolderPath("f1", "/x")).rejects.toThrow("Choose the folder on the show computer.");
  });
});
