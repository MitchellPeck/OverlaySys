import { describe, expect, it } from "vitest";
import {
  ApiBibleProvider, NIV_TRANSLATION, findNivBible, parseApiBibleText, passageId, type FetchLike,
} from "./apiBible";
import { ScriptureProviderError } from "../types";
import { parseReference } from "../reference";

// Recorded from rest.api.bible on 2026-10-21 (content trimmed to what the tests need).
const JHN_3_16_17 =
  "     [16] For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.  [17] For God did not send his Son into the world to condemn the world, but to save the world through him.\n";
const JHN_3_36_4_2 =
  "     [36] Whoever believes in the Son has eternal life, but whoever rejects the Son will not see life, for God’s wrath remains on them.\n     [1] Now Jesus learned that the Pharisees had heard that he was gaining and baptizing more disciples than John—  [2] although in fact it was not Jesus who baptized, but his disciples. \n";
const PSA_23_1_3 =
  "    Psalm 23\n   [1] The Lord is my shepherd, I lack nothing.\n     [2] He makes me lie down in green pastures,\n  he leads me beside quiet waters,\n     [3] he refreshes my soul.\n  He guides me along the right paths\n    for his name’s sake.\n";
const COPYRIGHT = "The Holy Bible, New International Version® NIV® Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.® Used by Permission of Biblica, Inc.® All rights reserved worldwide.";

function fakeFetch(routes: Record<string, { status?: number; body?: unknown } | Error>) {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const r = key ? routes[key]! : { status: 404, body: {} };
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    return { status, ok: status >= 200 && status < 300, json: async () => r.body };
  };
  return { f, calls };
}

const passageBody = (content: string, token: string) => ({
  data: { content, copyright: COPYRIGHT },
  meta: { fumsToken: token },
});

describe("parseApiBibleText", () => {
  it("splits on [n] markers and collapses whitespace", () => {
    const v = parseApiBibleText(JHN_3_16_17, "JHN", 3);
    expect(v.map((x) => [x.chapter, x.verse])).toEqual([[3, 16], [3, 17]]);
    expect(v[0]!.text).toBe("For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.");
  });

  it("advances the chapter when verse numbers restart", () => {
    const v = parseApiBibleText(JHN_3_36_4_2, "JHN", 3);
    expect(v.map((x) => `${x.chapter}:${x.verse}`)).toEqual(["3:36", "4:1", "4:2"]);
  });

  it("ignores headings before the first marker and joins poetry lines", () => {
    const v = parseApiBibleText(PSA_23_1_3, "PSA", 23);
    expect(v[0]!.text).toBe("The Lord is my shepherd, I lack nothing.");
    expect(v[1]!.text).toBe("He makes me lie down in green pastures, he leads me beside quiet waters,");
    expect(v).toHaveLength(3);
  });
});

describe("passageId", () => {
  it("formats single- and cross-chapter ranges", () => {
    expect(passageId("JHN", { chapter: 3, startVerse: 16, endChapter: 3, endVerse: 21 })).toBe("JHN.3.16-JHN.3.21");
    expect(passageId("JHN", { chapter: 3, startVerse: 36, endChapter: 4, endVerse: 2 })).toBe("JHN.3.36-JHN.4.2");
  });
});

describe("findNivBible", () => {
  it("matches abbreviationLocal NIV and sends the api-key header", async () => {
    const { f, calls } = fakeFetch({
      "/bibles?abbreviation=NIV": {
        body: { data: [{ id: "78a9f6124f344018-01", abbreviation: "NIV11", abbreviationLocal: "NIV" }] },
      },
    });
    expect(await findNivBible("k", f)).toEqual({ bibleId: "78a9f6124f344018-01" });
    expect(calls[0]!.headers).toEqual({ "api-key": "k" });
    expect(calls[0]!.url).toBe("https://rest.api.bible/v1/bibles?abbreviation=NIV");
  });

  it("returns null when no NIV is available", async () => {
    const { f } = fakeFetch({ "/bibles?abbreviation=NIV": { body: { data: [] } } });
    expect(await findNivBible("k", f)).toBeNull();
  });

  it("throws rejected on 401 and offline when fetch throws", async () => {
    const rejected = fakeFetch({ "/bibles": { status: 401, body: {} } });
    await expect(findNivBible("k", rejected.f)).rejects.toMatchObject({ code: "rejected" });
    const offline = fakeFetch({ "/bibles": new TypeError("fetch failed") });
    const err = await findNivBible("k", offline.f).catch((e) => e);
    expect(err).toBeInstanceOf(ScriptureProviderError);
    expect(err.code).toBe("offline");
    expect(err.message).toBe("Couldn't reach API.Bible");
  });
});

describe("ApiBibleProvider", () => {
  const make = (routes: Parameters<typeof fakeFetch>[0]) => {
    const ff = fakeFetch(routes);
    return { ...ff, p: new ApiBibleProvider({ apiKey: "k", bibleId: "B", translation: NIV_TRANSLATION, fetch: ff.f }) };
  };

  it("fetches a passage with the required query and returns source + attribution", async () => {
    const { p, calls } = make({ "/passages/JHN.3.16-JHN.3.17": { body: passageBody(JHN_3_16_17, "tok1") } });
    const out = await p.fetchPassage(parseReference("John 3:16-17"), "NIV");
    expect(out.verses).toHaveLength(2);
    expect(out.attribution).toBe(COPYRIGHT);
    expect(out.source).toEqual({ provider: "api.bible", bibleId: "B", usageTokens: ["tok1"] });
    expect(calls[0]!.url).toBe(
      "https://rest.api.bible/v1/bibles/B/passages/JHN.3.16-JHN.3.17?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false&fums-version=3",
    );
  });

  it("collects one token per range for multi-range references", async () => {
    const { p } = make({
      "/passages/JHN.3.16-JHN.3.17": { body: passageBody(JHN_3_16_17, "a") },
      "/passages/JHN.3.36-JHN.4.2": { body: passageBody(JHN_3_36_4_2, "b") },
    });
    const out = await p.fetchPassage(parseReference("John 3:16-17; John 3:36-4:2"), "NIV");
    expect(out.source!.usageTokens).toEqual(["a", "b"]);
    expect(out.verses.map((v) => `${v.chapter}:${v.verse}`)).toEqual(["3:16", "3:17", "3:36", "4:1", "4:2"]);
  });

  it("maps 404 to out_of_range and rejects >200-verse single-chapter ranges without a request", async () => {
    const { p, calls } = make({});
    await expect(p.fetchPassage(parseReference("John 3:16-17"), "NIV")).rejects.toMatchObject({ code: "out_of_range" });
    expect(calls).toHaveLength(1);
    await expect(
      p.fetchPassage([{ book: "PSA", ranges: [{ chapter: 119, startVerse: 1, endChapter: 119, endVerse: 201 }] }], "NIV"),
    ).rejects.toMatchObject({ code: "out_of_range" });
    expect(calls).toHaveLength(1);
  });
});
