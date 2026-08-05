import { expect, it } from "vitest";
import { createPcoClient } from "./pcoClient";

function mkItem(id: string, songId: string) {
  return {
    type: "Item",
    id,
    attributes: { title: id, sequence: Number(id.split("-")[1]), item_type: "song" },
    relationships: {
      song: { data: { type: "Song", id: songId } },
      arrangement: { data: { type: "Arrangement", id: `arr-${songId}` } },
    },
  };
}

it("one item's failure does not block another item's fallback", async () => {
  const impl = (async (url: string) => {
    if (url.includes("/plans/plan-1/items")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          data: [mkItem("item-1", "song-1"), mkItem("item-2", "song-2")],
          included: [
            { type: "Song", id: "song-1", attributes: { title: "A" } },
            { type: "Song", id: "song-2", attributes: { title: "B" } },
            { type: "Arrangement", id: "arr-song-1", attributes: { lyrics: "" } },
            { type: "Arrangement", id: "arr-song-2", attributes: { lyrics: "" } },
          ],
        }),
      };
    }
    if (url.includes("/songs/song-1/arrangements")) {
      return { ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) };
    }
    if (url.includes("/songs/song-2/arrangements")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          data: [
            { type: "Arrangement", id: "arr-song-2", attributes: { lyrics: "" } },
            { type: "Arrangement", id: "arr-alt", attributes: { name: "Alt", lyrics: "Verse\nx" } },
          ],
        }),
      };
    }
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;

  const items = await createPcoClient("Bearer x", impl).getPlanItems("st-1", "plan-1");
  expect(items).toHaveLength(2);
  expect(items[0]?.lyricsArrangement).toBeUndefined();
  expect(items[1]?.lyricsArrangement?.id).toBe("arr-alt");
});
