import { describe, expect, it } from "vitest";
import type { Show } from "@overlaysys/core";
import { liveGroups, nextRowId } from "./liveNext";
import type { AirState } from "./rowAirState";

const row = (id: string, sectionId?: string, lengthSec?: number) =>
  ({ kind: "graphic", id, templateId: "t", data: {}, sectionId, lengthSec }) as never;
const showWith = (o: object): Show => ({ id: "s", name: "S", projectId: "p", songs: [], rows: [], ...o }) as unknown as Show;

describe("liveGroups", () => {
  it("rows with an unknown sectionId stay visible in the no-section group", () => {
    const groups = liveGroups(
      showWith({ sections: [{ id: "a", name: "Gathering" }], rows: [row("1", "a"), row("2", "gone")] }),
    );
    expect(groups.flatMap((g) => g.rows).map((r) => r.id).sort()).toEqual(["1", "2"]);
  });
  it("sums section length and is null when no row has one; startIndex runs across groups", () => {
    const groups = liveGroups(
      showWith({
        sections: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
        rows: [row("1", "a", 60), row("2", "a", 90), row("3", "b")],
      }),
    );
    expect(groups.map((g) => g.lengthSec)).toEqual([150, null]);
    expect(groups.map((g) => g.startIndex)).toEqual([0, 2]);
  });
  it("with no sections is one flat group", () => {
    expect(liveGroups(showWith({ rows: [row("1"), row("2")] })).length).toBe(1);
  });
});

describe("nextRowId", () => {
  const rows = [row("r1"), row("r2"), row("r3")];
  const a = (o: Record<string, AirState>) => o;
  it("prefers the row cued on preview", () => {
    expect(nextRowId(rows, a({ r3: "preview", r1: "program" }), "r2")).toBe("r3");
  });
  it("is the selection when it isn't on program", () => {
    expect(nextRowId(rows, a({ r1: "program" }), "r2")).toBe("r2");
  });
  it("is the row after program when the selection is on air", () => {
    expect(nextRowId(rows, a({ r1: "program" }), "r1")).toBe("r2");
  });
  it("skips unsupported rows and is null at the end", () => {
    const rs = [row("r1"), { kind: "future", id: "r2" } as never, row("r3")];
    expect(nextRowId(rs, a({ r1: "program" }), "r1")).toBe("r3");
    expect(nextRowId(rs, a({ r3: "program" }), "r3")).toBeNull();
  });
});
