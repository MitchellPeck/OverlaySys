import { describe, expect, it } from "vitest";
import {
  BundleSchema,
  collectDependencies,
  detectImport,
  type BundleSelection,
} from "./bundle";

describe("BundleSchema", () => {
  it("accepts a minimal valid bundle", () => {
    const ok = BundleSchema.safeParse({
      format: "overlaysys-bundle",
      version: 1,
      exportedAt: "2026-05-08T00:00:00Z",
      songs: [],
      templates: [],
      shows: [],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects a JSON missing the format discriminator", () => {
    const result = BundleSchema.safeParse({
      version: 1,
      exportedAt: "2026-05-08T00:00:00Z",
      songs: [],
      templates: [],
      shows: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a wrong format string", () => {
    const result = BundleSchema.safeParse({
      format: "something-else",
      version: 1,
      exportedAt: "2026-05-08T00:00:00Z",
      songs: [],
      templates: [],
      shows: [],
    });
    expect(result.success).toBe(false);
  });

  it("treats songs/templates/shows arrays as defaulting to empty when omitted", () => {
    const ok = BundleSchema.parse({
      format: "overlaysys-bundle",
      version: 1,
      exportedAt: "2026-05-08T00:00:00Z",
    });
    expect(ok.songs).toEqual([]);
    expect(ok.templates).toEqual([]);
    expect(ok.shows).toEqual([]);
  });
});

describe("collectDependencies (skeleton)", () => {
  it("is a function that takes a selection and a store", () => {
    const empty: BundleSelection = { songIds: [], templateIds: [], showIds: [] };
    const out = collectDependencies(empty, {
      songs: new Map(),
      templates: new Map(),
      shows: new Map(),
    });
    expect(out.songs).toEqual([]);
    expect(out.templates).toEqual([]);
    expect(out.shows).toEqual([]);
    expect(out.missing).toEqual([]);
  });
});

describe("detectImport (skeleton)", () => {
  it("returns kind 'error' for non-recognized JSON", () => {
    expect(detectImport({ random: "junk" }).kind).toBe("error");
  });
});
