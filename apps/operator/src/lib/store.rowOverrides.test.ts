import { beforeEach, describe, expect, it } from "vitest";
import type { Show } from "@overlaysys/core";
import { useStore } from "./store";

const show = (id: string): Show =>
  ({
    id,
    name: id,
    rows: [{ kind: "graphic", id: "r1", templateId: "l3", data: { title: "Hi" } }],
    songs: [],
  }) as unknown as Show;

const overrides = () => useStore.getState().rowDataOverrides;

beforeEach(() => {
  useStore.setState({ show: null, selectedRowId: null, selectedHotcardId: null, rowDataOverrides: {} });
});

describe("setRowFieldOverride", () => {
  it("sets an override, then removes it (and the row entry) when equal to the original", () => {
    useStore.getState().setRowFieldOverride("r1", "title", "Edited", "Hi");
    expect(overrides()).toEqual({ r1: { title: "Edited" } });
    useStore.getState().setRowFieldOverride("r1", "title", "Hi", "Hi");
    expect(overrides()).toEqual({});
  });

  it("keeps other keys on the row when one is reverted", () => {
    useStore.getState().setRowFieldOverride("r1", "title", "Edited", "Hi");
    useStore.getState().setRowFieldOverride("r1", "sub", "New", undefined);
    useStore.getState().setRowFieldOverride("r1", "title", "Hi", "Hi");
    expect(overrides()).toEqual({ r1: { sub: "New" } });
  });
});

describe("clearRowOverrides", () => {
  it("removes every override for one row only", () => {
    useStore.getState().setRowFieldOverride("r1", "title", "Edited", "Hi");
    useStore.getState().setRowFieldOverride("r2", "title", "Other", "Hi");
    useStore.getState().clearRowOverrides("r1");
    expect(overrides()).toEqual({ r2: { title: "Other" } });
  });
});

describe("setShow and overrides", () => {
  it("clears overrides when a different show loads", () => {
    useStore.getState().setShow(show("a"));
    useStore.getState().setRowFieldOverride("r1", "title", "Edited", "Hi");
    useStore.getState().setShow(show("b"));
    expect(overrides()).toEqual({});
  });

  it("clears overrides when the show becomes null", () => {
    useStore.getState().setShow(show("a"));
    useStore.getState().setRowFieldOverride("r1", "title", "Edited", "Hi");
    useStore.getState().setShow(null);
    expect(overrides()).toEqual({});
  });

  it("keeps overrides when the same show is re-broadcast", () => {
    useStore.getState().setShow(show("a"));
    useStore.getState().setRowFieldOverride("r1", "title", "Edited", "Hi");
    useStore.getState().setShow(show("a"));
    expect(overrides()).toEqual({ r1: { title: "Edited" } });
  });
});
