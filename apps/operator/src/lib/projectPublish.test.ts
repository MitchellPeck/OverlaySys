import { describe, expect, it } from "vitest";
import type { Bundle } from "@overlaysys/core";
import { publishBundleUrl, publishProjectToCloud } from "./projectPublish";

const bundle: Bundle = {
  format: "overlaysys-bundle",
  version: 1,
  exportedAt: "2026-08-30T00:00:00.000Z",
  project: { id: "p1", name: "Sunday", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z" },
  songs: [],
  templates: [],
  shows: [],
  hotcards: [],
  channels: [],
  channelOverrides: [],
  assets: [],
};

const counts = { projects: 1, templates: 2, songs: 0, shows: 1, hotcards: 3, assets: 4 };

describe("publishBundleUrl", () => {
  it("targets the server's publish-bundle route with an encoded id", () => {
    expect(publishBundleUrl("http://127.0.0.1:4000", "a b/c")).toBe(
      "http://127.0.0.1:4000/api/projects/a%20b%2Fc/publish-bundle",
    );
  });
});

describe("publishProjectToCloud", () => {
  it("fetches the bundle, applies it to the cloud, then kicks a sync pass", async () => {
    const calls: string[] = [];
    const result = await publishProjectToCloud("p1", {
      fetchBundle: async (id) => {
        calls.push(`fetch:${id}`);
        return bundle;
      },
      applyBundle: async (b) => {
        calls.push(`apply:${b.project?.id}`);
        return { counts, errors: [] };
      },
      kickSync: async () => {
        calls.push("kick");
      },
    });
    expect(calls).toEqual(["fetch:p1", "apply:p1", "kick"]);
    expect(result).toEqual({ ok: true, counts, errors: [] });
  });

  it("reports per-entity errors as ok=false but still kicks sync for what landed", async () => {
    let kicked = 0;
    const errors = [{ kind: "asset", id: "x.png", message: "upload failed" }];
    const result = await publishProjectToCloud("p1", {
      fetchBundle: async () => bundle,
      applyBundle: async () => ({ counts, errors }),
      kickSync: async () => {
        kicked += 1;
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(errors);
    expect(kicked).toBe(1);
  });

  it("rejects a malformed bundle from the server before touching the cloud", async () => {
    let applied = false;
    await expect(
      publishProjectToCloud("p1", {
        fetchBundle: async () => ({ format: "nope" }),
        applyBundle: async () => {
          applied = true;
          return { counts, errors: [] };
        },
        kickSync: async () => {},
      }),
    ).rejects.toThrow(/bundle/i);
    expect(applied).toBe(false);
  });

  it("does not treat a failed sync kick as a publish failure", async () => {
    const result = await publishProjectToCloud("p1", {
      fetchBundle: async () => bundle,
      applyBundle: async () => ({ counts, errors: [] }),
      kickSync: async () => {
        throw new Error("server busy");
      },
    });
    expect(result.ok).toBe(true);
  });
});
