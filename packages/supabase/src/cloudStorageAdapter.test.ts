import { describe, expect, it } from "vitest";
import type { Project } from "@overlaysys/core";
import { CloudStorageAdapter } from "./cloudStorageAdapter";
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
