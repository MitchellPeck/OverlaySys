import { describe, expect, it } from "vitest";
import type { Show, ScriptureRow } from "@overlaysys/core";
import type { ScriptureVerse } from "@overlaysys/scripture";
import { refreshShow, runApiBibleRefresh, STALE_MS, type RefreshDeps } from "./refresh";

const NOW = new Date("2026-10-21T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const v = (verse: number, text: string): ScriptureVerse => ({ book: "JHN", chapter: 3, verse, text });

function row(fetchedAt: string, extra: Partial<ScriptureRow> = {}): ScriptureRow {
  return {
    kind: "scripture",
    id: "r1",
    reference: "John 3:16-17",
    translation: "NIV",
    templateId: "t",
    slides: [
      { id: "s-a", verses: [v(16, "For God so")] },
      { id: "s-b", verses: [v(16, "loved the world"), v(17, "For God did not")] },
    ],
    source: { provider: "api.bible", bibleId: "B", fetchedAt, usageTokens: ["old"] },
    ...extra,
  } as ScriptureRow;
}

const show = (...rows: Show["rows"]): Show => ({ id: "show1", name: "S", projectId: "p", rows } as unknown as Show);

function deps(verses: ScriptureVerse[] | Error): RefreshDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    now: NOW,
    staleMs: STALE_MS,
    fetchPassage: async (ref) => {
      calls.push(ref);
      if (verses instanceof Error) throw verses;
      return { verses, source: { provider: "api.bible", bibleId: "B", usageTokens: ["new"] } };
    },
  };
}

describe("refreshShow", () => {
  it("skips rows fetched within 14 days and non-api.bible rows", async () => {
    const d = deps([v(16, "x")]);
    const kjv = { ...row(daysAgo(30)), id: "r2", translation: "KJV", source: undefined } as ScriptureRow;
    expect(await refreshShow(show(row(daysAgo(13)), kjv), d)).toBeNull();
    expect(d.calls).toEqual([]);
  });

  it("same words → only source updated, slides and ids untouched", async () => {
    const d = deps([v(16, "For God so loved the world"), v(17, "For God did not")]);
    const out = await refreshShow(show(row(daysAgo(15))), d);
    const r = out!.rows[0] as ScriptureRow;
    expect(r.slides).toEqual(row(daysAgo(15)).slides);
    expect(r.source).toEqual({ provider: "api.bible", bibleId: "B", fetchedAt: NOW.toISOString(), usageTokens: ["new"] });
    expect(d.calls).toEqual(["John 3:16-17"]);
  });

  it("changed words → breaks kept at the same word position, ids kept", async () => {
    const d = deps([v(16, "For God so greatly loved the world"), v(17, "For God did not")]);
    const r = (await refreshShow(show(row(daysAgo(15))), d))!.rows[0] as ScriptureRow;
    expect(r.slides.map((s) => s.id)).toEqual(["s-a", "s-b"]);
    expect(r.slides[0]!.verses[0]!.text).toBe("For God so");
    expect(r.slides[1]!.verses[0]!.text).toBe("greatly loved the world");
  });

  it("fewer words → out-of-range breaks dropped, no empty slides, unique ids", async () => {
    const d = deps([v(16, "For")]);
    const r = (await refreshShow(show(row(daysAgo(15))), d))!.rows[0] as ScriptureRow;
    expect(r.slides).toHaveLength(1);
    expect(r.slides.every((s) => s.verses.length > 0)).toBe(true);
    expect(new Set(r.slides.map((s) => s.id)).size).toBe(r.slides.length);
  });

  it("fetch failure leaves the row untouched", async () => {
    expect(await refreshShow(show(row(daysAgo(40))), deps(new Error("offline")))).toBeNull();
  });

  it("runApiBibleRefresh is a no-op without a key (rows keep airing as stored)", async () => {
    // Fresh module state: no key configured → no provider → nothing loaded or saved.
    expect(await runApiBibleRefresh(NOW)).toBe(0);
  });

  it("unparseable fetchedAt counts as stale", async () => {
    const d = deps([v(16, "For God so loved the world"), v(17, "For God did not")]);
    expect(await refreshShow(show(row("garbage")), d)).not.toBeNull();
  });
});
