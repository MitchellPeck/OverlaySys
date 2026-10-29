import { describe, expect, it } from "vitest";
import { DeckLicensingSchema, DeckSchema } from "./deck";

describe("deck schema", () => {
  it("parses a minimal deck and keeps unknown keys", () => {
    const d = DeckSchema.parse({ id: "d1", name: "Response", defaultTemplateId: "lyric",
      licensing: { kind: "public-domain" }, slides: [{ id: "s1", data: { text: "Line A" } }],
      createdAt: "2026-10-28T00:00:00.000Z", futureField: 1 });
    expect(d.tags).toEqual([]);
    expect((d as Record<string, unknown>).futureField).toBe(1);
  });
  it("rejects an unknown licensing kind", () => {
    expect(DeckLicensingSchema.safeParse({ kind: "other" }).success).toBe(false);
  });
});

describe("[M8] DeckLicensingSchema passthrough", () => {
  it("keeps extra keys, still rejects unknown kinds", () => {
    expect(DeckLicensingSchema.parse({ kind: "ccli", ccliNumber: "1", future: true })).toEqual({ kind: "ccli", ccliNumber: "1", future: true });
    expect(DeckLicensingSchema.safeParse({ kind: "other" }).success).toBe(false);
  });
});

