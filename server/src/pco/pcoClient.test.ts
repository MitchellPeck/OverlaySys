import { describe, expect, it } from "vitest";
import { createPcoClient, PcoAuthError } from "./pcoClient";

/**
 * Minimal JSON:API responder keyed by URL substring. `statuses` optionally
 * overrides the HTTP status for a route (keyed the same way) so tests can
 * exercise failure paths; routes default to 200/ok.
 */
function stubFetch(
  routes: Record<string, unknown>,
  statuses: Record<string, number> = {},
): {
  impl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected fetch: ${url}`);
    const status = statuses[key] ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
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

/**
 * A plan whose only item is a header that (unrealistically) also carries song
 * and arrangement relationships — so asserting "no arrangements fetch" pins the
 * item-type guard specifically, rather than passing merely because there is no
 * song to look up.
 */
function headerItemsDoc() {
  return {
    data: [
      {
        type: "Item",
        id: "item-h",
        attributes: { title: "Welcome", sequence: 1, item_type: "header" },
        relationships: {
          song: { data: { type: "Song", id: "song-1" } },
          arrangement: { data: { type: "Arrangement", id: "arr-own" } },
        },
      },
    ],
    included: [
      { type: "Song", id: "song-1", attributes: { title: "Amazing Grace" } },
      { type: "Arrangement", id: "arr-own", attributes: { name: "Default", lyrics: "" } },
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
    const { impl, calls } = stubFetch({
      [ITEMS_ROUTE]: itemsDoc(""),
      [ARRANGEMENTS_ROUTE]: {
        data: [{ type: "Arrangement", id: "arr-own", attributes: { lyrics: "" } }],
      },
    });
    const client = createPcoClient("Bearer x", impl);

    expect((await client.getPlanItems("st-1", "plan-1"))[0]?.lyricsArrangement).toBeUndefined();
    // Absence alone would also hold if the fallback never ran — assert the
    // lookup actually happened and simply found nothing usable.
    expect(calls.some((c) => c.includes("/arrangements"))).toBe(true);
  });

  it("degrades a single song, not the plan, when the sibling fetch fails", async () => {
    const { impl } = stubFetch(
      { [ITEMS_ROUTE]: itemsDoc(""), [ARRANGEMENTS_ROUTE]: {} },
      { [ARRANGEMENTS_ROUTE]: 500 },
    );
    const client = createPcoClient("Bearer x", impl);

    // The fallback is an enhancement: a failing lookup must leave the plan
    // loadable (and importable) minus this one song's lyrics.
    const items = await client.getPlanItems("st-1", "plan-1");

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("item-1");
    expect(items[0]?.lyricsArrangement).toBeUndefined();
    expect(items[0]?.arrangement?.id).toBe("arr-own");
  });

  it("still throws PcoAuthError when the sibling fetch 401s", async () => {
    const { impl } = stubFetch(
      { [ITEMS_ROUTE]: itemsDoc(""), [ARRANGEMENTS_ROUTE]: {} },
      { [ARRANGEMENTS_ROUTE]: 401 },
    );
    const client = createPcoClient("Bearer x", impl);

    // An expired session affects every request, so it must reach the 401
    // handler instead of being swallowed as a per-song degradation.
    await expect(client.getPlanItems("st-1", "plan-1")).rejects.toBeInstanceOf(PcoAuthError);
  });

  it("never fetches arrangements for a header item", async () => {
    const { impl, calls } = stubFetch({ [ITEMS_ROUTE]: headerItemsDoc() });
    const client = createPcoClient("Bearer x", impl);

    const items = await client.getPlanItems("st-1", "plan-1");

    expect(items[0]?.itemType).toBe("header");
    expect(calls.some((c) => c.includes("/arrangements"))).toBe(false);
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
