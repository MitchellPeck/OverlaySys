import { describe, expect, it } from "vitest";
import type { TemplateMeta } from "@overlaysys/core";
import { templateRole, templatesFor } from "./templateRoles";

const m = (name: string, role?: TemplateMeta["role"]) => ({ id: name, name, size: { w: 1920, h: 1080 }, role });

describe("templateRole", () => {
  it("infers from the name", () => {
    expect(templateRole(m("Lyric — Default"))).toBe("lyric");
    expect(templateRole(m("Scripture"))).toBe("scripture");
    expect(templateRole(m("Song Intro"))).toBe("title");
    expect(templateRole(m("OLD Lower Third"))).toBe("other");
    expect(templateRole(m("Lower Third"))).toBe("graphic");
  });
  it("an explicit role wins", () => {
    expect(templateRole(m("Lyric — Default", "graphic"))).toBe("graphic");
  });
});

describe("templatesFor", () => {
  const all = ["Lyric — Default", "Scripture", "Lower Third", "OLD Lower Third"].map((n) => m(n));
  it("splits suggested from others without dropping any", () => {
    const r = templatesFor(all, "lyric");
    expect(r.suggested.map((t) => t.name)).toEqual(["Lyric — Default"]);
    expect(r.suggested.length + r.others.length).toBe(4);
    expect(r.others.map((t) => t.name)).toEqual(["Lower Third", "OLD Lower Third", "Scripture"]);
  });
  it("lists recent ids first", () => {
    const r = templatesFor(all.concat(m("Lyric — Alt")), "lyric", ["Lyric — Alt"]);
    expect(r.suggested.map((t) => t.name)).toEqual(["Lyric — Alt", "Lyric — Default"]);
  });
});
