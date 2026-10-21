import { describe, expect, it } from "vitest";
import type { Show, ScriptureRow } from "@overlaysys/core";
import type { ScriptureVerse } from "@overlaysys/scripture";
import { ShowSchema } from "@overlaysys/core";
import { refreshAllShows, refreshShow, runApiBibleRefresh, STALE_MS, type RefreshDeps, type RefreshIo } from "./refresh";

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

describe("refreshShow (empty response)", () => {
  it("an empty fetch leaves the row untouched instead of saving zero slides", async () => {
    expect(await refreshShow(show(row(daysAgo(15))), deps([]))).toBeNull();
  });
});

describe("refreshAllShows", () => {
  const valid = (rows: Show["rows"], id = "show1"): Show => ShowSchema.parse({ id, name: id, rows });
  const changedText = [v(16, "For God so greatly loved the world"), v(17, "For God did not")];

  function io(initial: Show[], duringFetch?: (store: Map<string, Show | null>) => void) {
    const store = new Map<string, Show | null>(initial.map((s) => [s.id, s]));
    const saved: Show[] = [];
    let fetched = false;
    const api: RefreshIo = {
      listShowIds: async () => [...store.keys()],
      getShow: async (id) => store.get(id) ?? null,
      saveShow: async (s) => {
        saved.push(s);
        store.set(s.id, s);
      },
    };
    const d: RefreshDeps = {
      now: NOW,
      staleMs: STALE_MS,
      fetchPassage: async () => {
        if (!fetched && duringFetch) duringFetch(store);
        fetched = true;
        return { verses: changedText, source: { provider: "api.bible", bibleId: "B", usageTokens: ["new"] } };
      },
    };
    return { api, d, saved, store };
  }

  it("saves a schema-valid refreshed show", async () => {
    const t = io([valid([row(daysAgo(15))])]);
    expect(await refreshAllShows(t.api, t.d)).toBe(1);
    expect(ShowSchema.safeParse(t.saved[0]).success).toBe(true);
    expect((t.saved[0]!.rows[0] as ScriptureRow).source!.fetchedAt).toBe(NOW.toISOString());
  });

  it("keeps operator edits to other rows saved during the fetch", async () => {
    const other = { kind: "graphic", id: "g1", templateId: "t", data: { name: "A" } } as unknown as Show["rows"][number];
    const t = io([valid([row(daysAgo(15)), other])], (store) => {
      const cur = store.get("show1")!;
      store.set("show1", { ...cur, name: "Renamed", rows: [cur.rows[0]!, { ...other, data: { name: "B" } } as Show["rows"][number]] });
    });
    expect(await refreshAllShows(t.api, t.d)).toBe(1);
    const out = t.saved[0]!;
    expect(out.name).toBe("Renamed");
    expect((out.rows[1] as unknown as { data: { name: string } }).data.name).toBe("B");
    expect((out.rows[0] as ScriptureRow).source!.fetchedAt).toBe(NOW.toISOString());
  });

  it("does not overwrite a scripture row the operator changed during the fetch", async () => {
    const t = io([valid([row(daysAgo(15))])], (store) => {
      const cur = store.get("show1")!;
      const r = cur.rows[0] as ScriptureRow;
      store.set("show1", { ...cur, rows: [{ ...r, slides: [{ id: "only", verses: [v(16, "edited")] }] }] });
    });
    expect(await refreshAllShows(t.api, t.d)).toBe(0);
    expect(t.saved).toHaveLength(0);
  });

  it("does not resurrect a show deleted during the fetch", async () => {
    const t = io([valid([row(daysAgo(15))])], (store) => store.set("show1", null));
    expect(await refreshAllShows(t.api, t.d)).toBe(0);
    expect(t.saved).toHaveLength(0);
  });
});
