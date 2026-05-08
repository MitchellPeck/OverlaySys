import { describe, expect, it } from "vitest";
import { isDoubleClick, pickGroupSelection } from "./groupSelection";

const G = (id: string) => ({ id, isGroup: true });
const L = (id: string) => ({ id, isGroup: false });

describe("pickGroupSelection", () => {
  it("returns BACKGROUND when chain is empty", () => {
    expect(pickGroupSelection([], null)).toEqual({ kind: "background" });
  });

  it("with no entered group, picks the outermost group in the chain", () => {
    // chain = innermost..outermost; click on a leaf inside group1 inside group2
    const chain = [L("leaf"), G("inner"), G("outer")];
    expect(pickGroupSelection(chain, null)).toEqual({ kind: "select", id: "outer" });
  });

  it("with no entered group and no groups in chain, picks the leaf", () => {
    const chain = [L("leaf")];
    expect(pickGroupSelection(chain, null)).toEqual({ kind: "select", id: "leaf" });
  });

  it("when the entered group is in the chain, picks the outermost group inside it", () => {
    // entered = "outer"; chain has outer at the top, inner one level down, leaf at bottom
    const chain = [L("leaf"), G("inner"), G("outer")];
    expect(pickGroupSelection(chain, "outer")).toEqual({ kind: "select", id: "inner" });
  });

  it("when the entered group is in the chain and slice has only a leaf, picks the leaf", () => {
    const chain = [L("leaf"), G("outer")];
    expect(pickGroupSelection(chain, "outer")).toEqual({ kind: "select", id: "leaf" });
  });

  it("when the click landed on the entered group itself with no descendant, exits", () => {
    // Click on the group's own padding/chrome — chain has only the group.
    const chain = [G("outer")];
    expect(pickGroupSelection(chain, "outer")).toEqual({ kind: "exit" });
  });

  it("when entered group is set but not in chain, falls through to outermost-group logic", () => {
    // User entered group "outer", then clicks somewhere outside it.
    const chain = [L("other-leaf"), G("other-group")];
    expect(pickGroupSelection(chain, "outer")).toEqual({
      kind: "select",
      id: "other-group",
    });
  });

  it("supports nested groups one level deep with no entered group", () => {
    // chain: leaf -> innerGroup -> middleGroup -> outerGroup
    const chain = [L("leaf"), G("innerG"), G("middleG"), G("outerG")];
    expect(pickGroupSelection(chain, null)).toEqual({ kind: "select", id: "outerG" });
  });

  it("supports nested groups when middle is entered", () => {
    const chain = [L("leaf"), G("innerG"), G("middleG"), G("outerG")];
    expect(pickGroupSelection(chain, "middleG")).toEqual({
      kind: "select",
      id: "innerG",
    });
  });
});

describe("isDoubleClick", () => {
  it("returns true when within threshold and groupId in chain", () => {
    const chain = [L("leaf"), G("g1")];
    expect(
      isDoubleClick(
        { time: 1000, groupId: "g1" },
        1200,
        chain,
        300,
      ),
    ).toBe(true);
  });

  it("returns false when over threshold", () => {
    const chain = [L("leaf"), G("g1")];
    expect(
      isDoubleClick({ time: 1000, groupId: "g1" }, 1500, chain, 300),
    ).toBe(false);
  });

  it("returns false when last groupId is null", () => {
    const chain = [L("leaf"), G("g1")];
    expect(
      isDoubleClick({ time: 1000, groupId: null }, 1100, chain, 300),
    ).toBe(false);
  });

  it("returns false when last groupId not in current chain", () => {
    const chain = [L("leaf"), G("other")];
    expect(
      isDoubleClick({ time: 1000, groupId: "g1" }, 1100, chain, 300),
    ).toBe(false);
  });
});
