import { describe, expect, it } from "vitest";
import { ProjectSchema, DEFAULT_PROJECT_ID } from "./project";

describe("ProjectSchema", () => {
  it("parses a minimal project", () => {
    const p = ProjectSchema.parse({
      id: "sunday-services",
      name: "Sunday Services",
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    });
    expect(p.id).toBe("sunday-services");
    expect(p.notes).toBeUndefined();
  });

  it("parses a project with optional notes", () => {
    const p = ProjectSchema.parse({
      id: "christmas-eve",
      name: "Christmas Eve",
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
      notes: "Special service",
    });
    expect(p.notes).toBe("Special service");
  });

  it("rejects missing required fields", () => {
    expect(() =>
      ProjectSchema.parse({ id: "x", name: "X" }),
    ).toThrow();
  });

  it("exports a stable DEFAULT_PROJECT_ID constant", () => {
    expect(DEFAULT_PROJECT_ID).toBe("default");
  });

  it("accepts an optional songCustomFieldSchema and round-trips it", () => {
    const p = ProjectSchema.parse({
      id: "sunday-services",
      name: "Sunday Services",
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
      songCustomFieldSchema: [
        { key: "writtenFor", label: "Written For" },
        { key: "yearWritten", label: "Year", type: "number" },
      ],
    });
    expect(p.songCustomFieldSchema).toEqual([
      { key: "writtenFor", label: "Written For" },
      { key: "yearWritten", label: "Year", type: "number" },
    ]);
  });

  it("leaves songCustomFieldSchema undefined when absent (legacy compat)", () => {
    const p = ProjectSchema.parse({
      id: "sunday-services",
      name: "Sunday Services",
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    });
    expect(p.songCustomFieldSchema).toBeUndefined();
  });
});
