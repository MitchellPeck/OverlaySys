import { describe, expect, it } from "vitest";
import { ApiBibleProvider, NIV_TRANSLATION, findNivBible, parseReference } from "@overlaysys/scripture";

const KEY = process.env["OVERLAYSYS_API_BIBLE_KEY"];

describe.skipIf(!KEY)("API.Bible live", () => {
  it("finds the NIV and fetches John 3:16 and a cross-chapter passage", async () => {
    const hit = await findNivBible(KEY!);
    expect(hit).not.toBeNull();
    const p = new ApiBibleProvider({ apiKey: KEY!, bibleId: hit!.bibleId, translation: NIV_TRANSLATION });
    const john = await p.fetchPassage(parseReference("John 3:16"), "NIV");
    expect(john.verses[0]!.text).toContain("For God so loved the world");
    expect(john.source!.usageTokens).toHaveLength(1);
    const cross = await p.fetchPassage(parseReference("John 3:36-4:2"), "NIV");
    expect(cross.verses.map((v) => `${v.chapter}:${v.verse}`)).toEqual(["3:36", "4:1", "4:2"]);
  }, 20_000);
});
