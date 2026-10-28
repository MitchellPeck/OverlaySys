import { describe, expect, it } from "vitest";
import { findCcliDuplicate, resolveImportId, uniqueSlug } from "./songImport";

describe("uniqueSlug", () => {
  it("keeps a free slug", () => {
    expect(uniqueSlug("amazing", new Set())).toBe("amazing");
  });
  it("suffixes past every taken variant", () => {
    expect(uniqueSlug("amazing", new Set(["amazing", "amazing-2"]))).toBe("amazing-3");
  });
});

describe("findCcliDuplicate", () => {
  const songs = [
    { id: "a", title: "A", ccliNumber: "123" },
    { id: "b", title: "B" },
  ];
  it("matches trimmed CCLI numbers", () => {
    expect(findCcliDuplicate(" 123 ", songs)?.id).toBe("a");
  });
  it("never matches a blank CCLI", () => {
    expect(findCcliDuplicate("", songs)).toBeNull();
    expect(findCcliDuplicate(undefined, songs)).toBeNull();
  });
});

describe("resolveImportId", () => {
  const dup = { id: "existing", title: "X", ccliNumber: "1" };
  it("replace keeps the duplicate's id", () => {
    expect(resolveImportId("new", new Set(["existing"]), dup, "replace")).toBe("existing");
  });
  it("copy auto-suffixes a colliding slug instead of overwriting", () => {
    expect(resolveImportId("existing", new Set(["existing"]), dup, "copy")).toBe("existing-2");
  });
  it("a slug colliding with a non-duplicate song is suffixed too", () => {
    expect(resolveImportId("other", new Set(["other"]), null, "copy")).toBe("other-2");
  });
});
