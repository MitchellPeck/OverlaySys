import { describe, it, expect, vi } from "vitest";
import {
  OvationCloudStorageAdapter,
  OvationCloudError,
  type OvationSyncRecord,
} from "./ovationAdapter";
import type { Show } from "./show";

const WS = "ws-1";

/**
 * A fetch double that records requests and replays queued JSON responses.
 * Keyed loosely by method + path so a test can script a pull then a push.
 */
function mockFetch(
  handler: (url: string, init?: RequestInit) => { status?: number; body: unknown },
) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({
      url: u,
      method: init?.method ?? "GET",
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    const { status = 200, body } = handler(u, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function adapter(fetchImpl: typeof fetch) {
  return new OvationCloudStorageAdapter({
    baseUrl: "https://api.example.com/",
    operatorKey: "key-123",
    fetchImpl,
  });
}

function showRecord(over: Partial<OvationSyncRecord> = {}): OvationSyncRecord {
  return {
    id: "show-1",
    updatedAt: "2026-08-02T12:00:00.000Z",
    projectId: "proj-1",
    payload: {
      id: "show-1",
      name: "Keynote",
      projectId: "proj-1",
      rows: [],
      songs: [],
    },
    ...over,
  };
}

describe("transport", () => {
  it("sends the operator key and strips a trailing slash from the base URL", async () => {
    const { impl, calls } = mockFetch(() => ({ body: { records: [], watermark: null } }));
    await adapter(impl).listShowsSince(WS, "");

    expect(calls[0]!.url).toContain("https://api.example.com/workspaces/ws-1/overlay/sync/shows");
    expect(calls[0]!.url).not.toContain("//workspaces");
    const headers = (impl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]![1]!.headers as Record<string, string>;
    expect(headers["x-overlay-key"]).toBe("key-123");
  });

  it("surfaces the API's error message", async () => {
    const { impl } = mockFetch(() => ({ status: 401, body: { message: "Invalid or missing overlay operator key" } }));
    await expect(adapter(impl).listShowsSince(WS, "")).rejects.toThrow(
      "Invalid or missing overlay operator key",
    );
  });

  it("still throws usefully when the error body isn't JSON", async () => {
    const { impl } = mockFetch(() => ({
      status: 503,
      body: undefined,
    }));
    const a = adapter(impl);
    // Force a non-JSON body by making json() reject.
    const bad = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => { throw new Error("not json"); },
    })) as unknown as typeof fetch;
    await expect(adapter(bad).listShowsSince(WS, "")).rejects.toBeInstanceOf(OvationCloudError);
    expect(a).toBeDefined();
  });
});

describe("pull + decode", () => {
  it("decodes records into domain entities", async () => {
    const { impl } = mockFetch(() => ({
      body: { records: [showRecord()], watermark: "2026-08-02T12:00:00.000Z" },
    }));
    const shows = await adapter(impl).listShowsSince(WS, "");
    expect(shows).toHaveLength(1);
    expect(shows[0]!.name).toBe("Keynote");
  });

  it("re-merges the transport updatedAt/deletedAt onto the payload", async () => {
    const { impl } = mockFetch(() => ({
      body: {
        records: [
          showRecord({
            updatedAt: "2026-08-03T00:00:00.000Z",
            deletedAt: "2026-08-03T00:00:00.000Z",
          }),
        ],
        watermark: null,
      },
    }));
    const shows = await adapter(impl).listShowsSince(WS, "");
    expect(shows[0]!.updatedAt).toBe("2026-08-03T00:00:00.000Z");
    expect(shows[0]!.deletedAt).toBe("2026-08-03T00:00:00.000Z");
  });

  it("drops a malformed record rather than failing the whole pass", async () => {
    const { impl } = mockFetch(() => ({
      body: {
        records: [showRecord(), showRecord({ id: "bad", payload: { nope: true } })],
        watermark: null,
      },
    }));
    const shows = await adapter(impl).listShowsSince(WS, "");
    expect(shows.map((s) => s.id)).toEqual(["show-1"]);
  });

  it("list* hides tombstones while list*Since keeps them", async () => {
    const records = [
      showRecord(),
      showRecord({ id: "show-2", deletedAt: "2026-08-03T00:00:00.000Z", payload: { id: "show-2", name: "Gone", projectId: "proj-1", rows: [], songs: [] } }),
    ];
    const { impl } = mockFetch(() => ({ body: { records, watermark: null } }));
    const a = adapter(impl);
    expect((await a.listShowsSince(WS, "")).map((s) => s.id)).toEqual(["show-1", "show-2"]);
    expect((await a.listShows(WS)).map((s) => s.id)).toEqual(["show-1"]);
  });

  it("filters shows by project when asked", async () => {
    const records = [
      showRecord(),
      showRecord({ id: "show-2", projectId: "proj-2", payload: { id: "show-2", name: "Other", projectId: "proj-2", rows: [], songs: [] } }),
    ];
    const { impl } = mockFetch(() => ({ body: { records, watermark: null } }));
    expect((await adapter(impl).listShows(WS, "proj-2")).map((s) => s.id)).toEqual(["show-2"]);
  });

  it("passes the watermark through and stops on a short page", async () => {
    const { impl, calls } = mockFetch(() => ({
      body: { records: [showRecord()], watermark: "2026-08-02T12:00:00.000Z" },
    }));
    await adapter(impl).listShowsSince(WS, "2026-08-01T00:00:00.000Z");
    expect(calls).toHaveLength(1); // one short page -> no second request
    expect(calls[0]!.url).toContain(`since=${encodeURIComponent("2026-08-01T00:00:00.000Z")}`);
  });

  it("stops paging when the watermark stops advancing", async () => {
    // A full page whose watermark never moves would otherwise loop forever.
    const full = Array.from({ length: 500 }, (_, i) =>
      showRecord({ id: `show-${i}`, payload: { id: `show-${i}`, name: `S${i}`, projectId: "p", rows: [], songs: [] } }),
    );
    const { impl, calls } = mockFetch(() => ({
      body: { records: full, watermark: "2026-08-02T12:00:00.000Z" },
    }));
    await adapter(impl).listShowsSince(WS, "2026-08-02T12:00:00.000Z");
    expect(calls.length).toBeLessThan(3);
  });
});

describe("push", () => {
  it("saves a show as a record carrying its writer-supplied updatedAt", async () => {
    const { impl, calls } = mockFetch(() => ({ body: { written: 1, skipped: 0 } }));
    const show: Show = {
      id: "show-1",
      name: "Keynote",
      projectId: "proj-1",
      rows: [],
      songs: [],
      updatedAt: "2026-08-02T12:00:00.000Z",
    };
    await adapter(impl).saveShow(WS, show);

    expect(calls[0]!.method).toBe("POST");
    const body = calls[0]!.body as { records: OvationSyncRecord[] };
    expect(body.records[0]!.id).toBe("show-1");
    expect(body.records[0]!.updatedAt).toBe("2026-08-02T12:00:00.000Z");
    expect(body.records[0]!.projectId).toBe("proj-1");
  });

  it("deletes by pushing a tombstone, not by removing the row", async () => {
    const { impl, calls } = mockFetch((url, init) =>
      init?.method === "POST"
        ? { body: { written: 1, skipped: 0 } }
        : { body: { records: [showRecord()], watermark: null } },
    );
    const ok = await adapter(impl).deleteShow(WS, "show-1");
    expect(ok).toBe(true);

    const push = calls.find((c) => c.method === "POST")!;
    const rec = (push.body as { records: OvationSyncRecord[] }).records[0]!;
    expect(rec.deletedAt).toBeTruthy();
    expect(rec.updatedAt).toBe(rec.deletedAt); // tombstone dates the write
  });

  it("returns false when there is nothing to delete", async () => {
    const { impl } = mockFetch(() => ({ body: { records: [], watermark: null } }));
    expect(await adapter(impl).deleteShow(WS, "missing")).toBe(false);
  });

  it("does not re-tombstone an already deleted record", async () => {
    const { impl } = mockFetch(() => ({
      body: { records: [showRecord({ deletedAt: "2026-08-03T00:00:00.000Z" })], watermark: null },
    }));
    expect(await adapter(impl).deleteShow(WS, "show-1")).toBe(false);
  });
});

describe("project channel overrides", () => {
  it("round-trips the composite key", async () => {
    const { impl, calls } = mockFetch((_u, init) =>
      init?.method === "POST"
        ? { body: { written: 1, skipped: 0 } }
        : {
            body: {
              records: [
                {
                  id: "proj-1:program",
                  updatedAt: "2026-08-02T12:00:00.000Z",
                  projectId: "proj-1",
                  channelId: "program",
                  payload: { renderMode: "matte" },
                },
              ],
              watermark: null,
            },
          },
    );
    const a = adapter(impl);

    // The key parts are hydrated from the record even when the payload omits them.
    const list = await a.listProjectChannelOverrides(WS);
    expect(list[0]!.projectId).toBe("proj-1");
    expect(list[0]!.channelId).toBe("program");

    await a.saveProjectChannelOverride(WS, {
      projectId: "proj-1",
      channelId: "program",
      updatedAt: "2026-08-02T12:00:00.000Z",
    });
    const push = calls.find((c) => c.method === "POST")!;
    expect((push.body as { records: OvationSyncRecord[] }).records[0]!.id).toBe("proj-1:program");
  });
});

describe("assets", () => {
  it("reports no assets rather than pretending, and refuses writes", async () => {
    const { impl } = mockFetch(() => ({ body: {} }));
    const a = adapter(impl);
    expect(await a.hasAsset()).toBe(false);
    expect(await a.getAssetUrl()).toBeNull();
    await expect(a.putAsset()).rejects.toThrow(/not implemented/i);
  });
});

describe("hello", () => {
  it("returns the workspace identity for the connect handshake", async () => {
    const { impl, calls } = mockFetch(() => ({
      body: { success: true, workspace_id: WS, workspace_name: "Main Stage", default_channel: "program" },
    }));
    const res = await adapter(impl).hello(WS);
    expect(res.workspace_name).toBe("Main Stage");
    expect(calls[0]!.url).toContain("/overlay/sync/hello");
  });
});
