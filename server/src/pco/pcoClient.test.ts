import { describe, expect, it } from "vitest";
import { createPcoClient } from "./pcoClient";

/** Minimal JSON:API responder keyed by URL substring. */
function stubFetch(routes: Record<string, unknown>): {
  impl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected fetch: ${url}`);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => routes[key],
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ITEMS_ROUTE = "/plans/plan-1/items";
const ARRANGEMENTS_ROUTE = "/songs/song-1/arrangements";

function itemsDoc(arrangementLyrics: string) {
  return {
    data: [
      {
        type: "Item",
        id: "item-1",
        attributes: { title: "Amazing Grace", sequence: 1, item_type: "song" },
        relationships: {
          song: { data: { type: "Song", id: "song-1" } },
          arrangement: { data: { type: "Arrangement", id: "arr-own" } },
        },
      },
    ],
    included: [
      { type: "Song", id: "song-1", attributes: { title: "Amazing Grace" } },
      {
        type: "Arrangement",
        id: "arr-own",
        attributes: { name: "Default", lyrics: arrangementLyrics },
      },
    ],
  };
}

describe("getPlanItems lyrics fallback", () => {
  it("does not fetch arrangements when the item's own has lyrics", async () => {
    const { impl, calls } = stubFetch({ [ITEMS_ROUTE]: itemsDoc("Verse 1\nmine") });
    const client = createPcoClient("Bearer x", impl);

    const items = await client.getPlanItems("st-1", "plan-1");

    expect(items[0]?.lyricsArrangement).toBeUndefined();
    expect(calls.some((c) => c.includes("/arrangements"))).toBe(false);
  });

  it("falls back to a sibling arrangement that has lyrics", async () => {
    const { impl } = stubFetch({
      [ITEMS_ROUTE]: itemsDoc(""),
      [ARRANGEMENTS_ROUTE]: {
        data: [
          { type: "Arrangement", id: "arr-own", attributes: { name: "Default", lyrics: "" } },
          {
            type: "Arrangement",
            id: "arr-acoustic",
            attributes: { name: "Acoustic in G", lyrics: "Verse 1\ntheirs", sequence: ["Verse 1"] },
          },
        ],
      },
    });
    const client = createPcoClient("Bearer x", impl);

    const items = await client.getPlanItems("st-1", "plan-1");

    expect(items[0]?.lyricsArrangement?.id).toBe("arr-acoustic");
    expect(items[0]?.lyricsArrangement?.sequence).toEqual(["Verse 1"]);
    // The item's own arrangement is still reported truthfully.
    expect(items[0]?.arrangement?.id).toBe("arr-own");
  });

  it("leaves lyricsArrangement unset when no sibling has lyrics", async () => {
    const { impl } = stubFetch({
      [ITEMS_ROUTE]: itemsDoc(""),
      [ARRANGEMENTS_ROUTE]: {
        data: [{ type: "Arrangement", id: "arr-own", attributes: { lyrics: "" } }],
      },
    });
    const client = createPcoClient("Bearer x", impl);

    expect((await client.getPlanItems("st-1", "plan-1"))[0]?.lyricsArrangement).toBeUndefined();
  });

  it("listSongArrangements parses name, lyrics and sequence", async () => {
    const { impl } = stubFetch({
      [ARRANGEMENTS_ROUTE]: {
        data: [
          {
            type: "Arrangement",
            id: "arr-1",
            attributes: { name: "Band", lyrics: "Chorus\nx", sequence: ["Chorus"] },
          },
        ],
      },
    });
    const client = createPcoClient("Bearer x", impl);

    const arrangements = await client.listSongArrangements("song-1");

    expect(arrangements).toEqual([
      { id: "arr-1", name: "Band", lyrics: "Chorus\nx", sequence: ["Chorus"] },
    ]);
  });
});
