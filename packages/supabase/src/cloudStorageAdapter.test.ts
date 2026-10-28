import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShowSchema, type Hotcard, type Project, type Show } from "@overlaysys/core";
import { CloudStorageAdapter } from "./cloudStorageAdapter";
import { _resetOptionalColumnsForTest, showExtra } from "./optionalColumns";
import type { OverlaySysSupabaseClient } from "./index";

/**
 * Fake `projects` table that models the two things the real backend does
 * and the in-memory fakes in syncEngine.test.ts do not:
 *
 *   1. It only persists the columns declared in supabase/migrations —
 *      anything the adapter fails to send is simply lost.
 *   2. It runs the `set_updated_at` BEFORE UPDATE trigger, in the form
 *      0010 gives it: now() is stamped only when the writer leaves the
 *      column alone, so a client that manages `updated_at` itself (the
 *      sync engine) keeps its value through a conflict-update.
 *
 * Together these are what make a real publish differ from a fake one.
 */
type Row = Record<string, unknown>;

const ORG = "org-1";

class FakeProjects {
  rows: Row[] = [];
  /** Stands in for postgres `now()` during a trigger fire. */
  clock = "2026-08-29T12:00:00.000Z";

  upsert(incoming: Row[]): { error: null } {
    for (const row of incoming) {
      const idx = this.rows.findIndex(
        (r) => r["org_id"] === row["org_id"] && r["id"] === row["id"],
      );
      if (idx === -1) {
        // INSERT — the trigger is BEFORE UPDATE only, so it does not fire.
        this.rows.push({ updated_at: this.clock, ...row });
      } else {
        // UPDATE — set_updated_at() as of 0010: stamp now() only when the
        // writer left updated_at at its previous value, so an explicit
        // one survives.
        const prev = this.rows[idx]!;
        const merged: Row = { ...prev, ...row };
        if (merged["updated_at"] === prev["updated_at"]) {
          merged["updated_at"] = this.clock;
        }
        this.rows[idx] = merged;
      }
    }
    return { error: null };
  }

  select(filters: Row, includeTombstones: boolean): Row[] {
    return this.rows.filter((r) => {
      for (const [k, v] of Object.entries(filters)) if (r[k] !== v) return false;
      return includeTombstones ? true : r["deleted_at"] == null;
    });
  }
}

/** Minimal thenable query builder covering the calls the adapter makes. */
function makeClient(table: FakeProjects): OverlaySysSupabaseClient {
  const client = {
    from() {
      const filters: Row = {};
      let includeTombstones = true;
      const builder = {
        upsert: (rows: Row[]) => Promise.resolve(table.upsert(rows)),
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        is: (col: string, val: unknown) => {
          if (col === "deleted_at" && val === null) includeTombstones = false;
          return builder;
        },
        maybeSingle: () =>
          Promise.resolve({
            data: table.select(filters, includeTombstones)[0] ?? null,
            error: null,
          }),
        then: (resolve: (r: { data: Row[]; error: null }) => unknown) =>
          resolve({ data: table.select(filters, includeTombstones), error: null }),
      };
      return builder;
    },
  };
  return client as unknown as OverlaySysSupabaseClient;
}

const baseProject: Project = {
  id: "sunday-services",
  name: "Sunday Services",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
};

describe("CloudStorageAdapter project publish", () => {
  it("round-trips songCustomFieldSchema through the cloud", async () => {
    const table = new FakeProjects();
    const adapter = new CloudStorageAdapter(makeClient(table));
    const project: Project = {
      ...baseProject,
      songCustomFieldSchema: [
        { key: "ccli", label: "CCLI #", type: "text" },
        { key: "tempo", label: "Tempo", type: "number" },
      ],
    };

    await adapter.saveProject(ORG, project);
    const fetched = await adapter.getProject(ORG, project.id);

    expect(fetched?.songCustomFieldSchema).toEqual(project.songCustomFieldSchema);
  });

  it("preserves a client-supplied updatedAt so LWW converges", async () => {
    const table = new FakeProjects();
    const adapter = new CloudStorageAdapter(makeClient(table));

    // First push inserts the row.
    await adapter.saveProject(ORG, baseProject);
    // Second push is the conflict-update path, where the trigger fires.
    const edited: Project = { ...baseProject, name: "Renamed", updatedAt: "2026-08-28T10:00:00.000Z" };
    await adapter.saveProject(ORG, edited);

    const fetched = await adapter.getProject(ORG, edited.id);

    // If the remote comes back newer than what we pushed, the next sync
    // pass pulls this row straight back down and reports an overwrite —
    // publish never settles.
    expect(fetched?.updatedAt).toBe(edited.updatedAt);
  });
});

// ── Optional columns: shows.extra and hotcards.hotkey ─────────────────────

/**
 * A fake table that knows which columns the cloud schema has. Like
 * PostgREST, an upsert naming an unknown column fails with PGRST204 and a
 * select naming one fails with 42703. Rows persist only declared columns.
 */
class FakeTable {
  rows: Row[] = [];
  constructor(
    readonly name: string,
    readonly columns: Set<string>,
  ) {}

  upsert(incoming: Row[]): { error: { code: string; message: string } | null } {
    for (const row of incoming) {
      const unknown = Object.keys(row).find((k) => !this.columns.has(k));
      if (unknown) {
        return {
          error: {
            code: "PGRST204",
            message: `Could not find the '${unknown}' column of '${this.name}' in the schema cache`,
          },
        };
      }
    }
    for (const row of incoming) {
      const idx = this.rows.findIndex((r) => r["org_id"] === row["org_id"] && r["id"] === row["id"]);
      const prev = idx === -1 ? {} : this.rows[idx]!;
      const merged: Row = { updated_at: "2026-10-28T00:00:00.000Z", ...prev, ...row };
      if (idx === -1) this.rows.push(merged);
      else this.rows[idx] = merged;
    }
    return { error: null };
  }

  select(
    cols: string,
    filters: Row,
    includeTombstones: boolean,
  ): { data: Row[] | null; error: { code: string; message: string } | null } {
    const wanted = cols.split(",").map((c) => c.trim()).filter(Boolean);
    const unknown = wanted.find((c) => !this.columns.has(c));
    if (unknown) return { data: null, error: { code: "42703", message: `column ${this.name}.${unknown} does not exist` } };
    const data = this.rows
      .filter((r) => {
        for (const [k, v] of Object.entries(filters)) if (r[k] !== v) return false;
        return includeTombstones ? true : r["deleted_at"] == null;
      })
      .map((r) => Object.fromEntries(wanted.map((c) => [c, r[c] ?? null])));
    return { data, error: null };
  }
}

const SHOW_COLS = ["id", "org_id", "project_id", "name", "rows", "updated_at", "deleted_at"];
const HOTCARD_COLS = [
  "id", "org_id", "project_id", "name", "template_id", "data", "channel_hint", "notes", "updated_at", "deleted_at",
];

function makeTables(opts: { extra: boolean; hotkey: boolean }): Record<string, FakeTable> {
  return {
    shows: new FakeTable("shows", new Set([...SHOW_COLS, ...(opts.extra ? ["extra"] : [])])),
    hotcards: new FakeTable("hotcards", new Set([...HOTCARD_COLS, ...(opts.hotkey ? ["hotkey"] : [])])),
  };
}

function makeMultiClient(tables: Record<string, FakeTable>): OverlaySysSupabaseClient {
  const client = {
    from(name: string) {
      const table = tables[name]!;
      const filters: Row = {};
      let cols = "";
      let includeTombstones = true;
      const builder = {
        upsert: (rows: Row[]) => Promise.resolve(table.upsert(rows)),
        select: (c: string) => {
          cols = c;
          return builder;
        },
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        is: (col: string, val: unknown) => {
          if (col === "deleted_at" && val === null) includeTombstones = false;
          return builder;
        },
        maybeSingle: () => {
          const r = table.select(cols, filters, includeTombstones);
          return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error });
        },
        then: (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(table.select(cols, filters, includeTombstones)).then(resolve, reject),
      };
      return builder;
    },
  };
  return client as unknown as OverlaySysSupabaseClient;
}

const richShow = (): Show =>
  ShowSchema.parse({
    id: "show-1",
    name: "Sunday",
    projectId: "p1",
    scheduledFor: "2026-11-01",
    sections: [{ id: "sec-1", name: "Opening" }],
    songs: [{ songId: "song-1" }],
    sermonNotes: [{ id: "n1", title: "Title A", body: "Line A" }],
    rows: [
      // A row carries its sectionId (and any future keys, e.g. a slides
      // row's deckId) inside `rows`, which the schema passes through.
      { kind: "graphic", id: "r1", sectionId: "sec-1", templateId: "l3", data: {}, futureKey: "kept" },
      {
        kind: "slides",
        id: "r2",
        sectionId: "sec-1",
        deckId: "deck-1",
        slideIds: ["s2", "s1", "s2"],
        stageLayouts: { "stage-1": "speaker" },
        localSlides: [{ id: "l1", data: { line1: "Line A" } }],
      },
    ],
    updatedAt: "2026-10-28T10:00:00.000Z",
  });

describe("CloudStorageAdapter optional columns", () => {
  beforeEach(() => {
    _resetOptionalColumnsForTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saveShow writes extra; listShowsSince reads sections, songs, scheduledFor and slides rows back", async () => {
    const tables = makeTables({ extra: true, hotkey: true });
    const adapter = new CloudStorageAdapter(makeMultiClient(tables));
    const show = richShow();
    await adapter.saveShow(ORG, show);

    expect(tables["shows"]!.rows[0]!["extra"]).toEqual(showExtra(show));
    const [pulled] = await adapter.listShowsSince(ORG, "");
    expect(pulled?.sections).toEqual(show.sections);
    expect(pulled?.songs).toEqual(show.songs);
    expect(pulled?.scheduledFor).toBe("2026-11-01");
    expect(pulled?.sermonNotes).toEqual(show.sermonNotes);
    expect(pulled?.rows).toEqual(show.rows);
    const slides = pulled?.rows.find((r) => r.id === "r2");
    expect(slides).toMatchObject({ kind: "slides", deckId: "deck-1", slideIds: ["s2", "s1", "s2"], sectionId: "sec-1" });
    const got = await adapter.getShow(ORG, "show-1");
    expect(got?.sections).toEqual(show.sections);
    expect(got?.rows).toEqual(show.rows);
  });

  it("an old row with extra = null reads as today (songs [])", async () => {
    const tables = makeTables({ extra: true, hotkey: true });
    tables["shows"]!.rows.push({
      id: "old", org_id: ORG, project_id: "p1", name: "Old", rows: [], extra: null,
      updated_at: "2026-01-01T00:00:00+00:00", deleted_at: null,
    });
    const adapter = new CloudStorageAdapter(makeMultiClient(tables));
    const [pulled] = await adapter.listShows(ORG);
    expect(pulled).toEqual({
      id: "old", name: "Old", projectId: "p1", rows: [], songs: [], updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect("sections" in pulled!).toBe(false);
  });

  it("without the extra column: save retries without it, list still works, one info log", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const tables = makeTables({ extra: false, hotkey: true });
    const adapter = new CloudStorageAdapter(makeMultiClient(tables));
    await adapter.saveShow(ORG, richShow());
    await adapter.saveShow(ORG, { ...richShow(), name: "Again" });

    expect(tables["shows"]!.rows).toHaveLength(1);
    expect(tables["shows"]!.rows[0]!["name"]).toBe("Again");
    const [pulled] = await adapter.listShowsSince(ORG, "");
    expect(pulled?.rows).toEqual(richShow().rows);
    expect("sections" in pulled!).toBe(false);
    expect((await adapter.getShow(ORG, "show-1"))?.name).toBe("Again");

    // A second adapter in the same process stays quiet too.
    const other = new CloudStorageAdapter(makeMultiClient(tables));
    await other.listShows(ORG);

    const lines = info.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("shows.extra"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[sync\] cloud shows\.extra column unavailable; /);
  });

  it("hotcard hotkey round-trips F-key, deliberate none, and absent", async () => {
    const tables = makeTables({ extra: true, hotkey: true });
    const adapter = new CloudStorageAdapter(makeMultiClient(tables));
    const card = (id: string, extra: Partial<Hotcard>): Hotcard => ({
      id, name: id, projectId: "p1", templateId: "l3", data: {}, ...extra,
    });
    await adapter.saveHotcard(ORG, card("a", { hotkey: "F3" }));
    await adapter.saveHotcard(ORG, card("b", { hotkey: null }));
    await adapter.saveHotcard(ORG, card("c", {}));

    expect(tables["hotcards"]!.rows.map((r) => r["hotkey"])).toEqual(["F3", "none", null]);
    const byId = new Map((await adapter.listHotcardsSince(ORG, "")).map((h) => [h.id, h]));
    expect(byId.get("a")?.hotkey).toBe("F3");
    expect(byId.get("b")?.hotkey).toBeNull();
    expect(byId.get("c")?.hotkey).toBeUndefined();
    expect("hotkey" in byId.get("c")!).toBe(false);
    expect((await adapter.getHotcard(ORG, "a"))?.hotkey).toBe("F3");
  });

  it("without the hotkey column: save and list still work", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const tables = makeTables({ extra: true, hotkey: false });
    const adapter = new CloudStorageAdapter(makeMultiClient(tables));
    await adapter.saveHotcard(ORG, {
      id: "a", name: "Pastor", projectId: "p1", templateId: "l3", data: {}, hotkey: "F4",
    });

    expect(tables["hotcards"]!.rows).toHaveLength(1);
    const [pulled] = await adapter.listHotcards(ORG);
    expect(pulled?.name).toBe("Pastor");
    expect(pulled?.hotkey).toBeUndefined();
    expect((await adapter.getHotcard(ORG, "a"))?.name).toBe("Pastor");
    expect(info.mock.calls.filter((c) => String(c[0]).includes("hotcards.hotkey"))).toHaveLength(1);
  });
});
