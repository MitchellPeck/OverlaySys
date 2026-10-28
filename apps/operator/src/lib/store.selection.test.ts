import { beforeEach, describe, expect, it } from "vitest";
import type { Show } from "@overlaysys/core";
import { useStore } from "./store";

const show = (id: string, rowIds: string[] = ["r1", "r2"]): Show =>
  ({
    id,
    name: id,
    rows: rowIds.map((rid) => ({ kind: "graphic", id: rid, templateId: "l3", data: {} })),
    songs: [],
  }) as unknown as Show;

beforeEach(() => {
  useStore.setState({
    show: null,
    requestedShowId: null,
    selectedRowId: null,
    selectedHotcardId: null,
    rowDataOverrides: {},
  });
});

describe("setShow selection", () => {
  it("selects the first row on first load", () => {
    useStore.getState().setShow(show("a"));
    expect(useStore.getState().selectedRowId).toBe("r1");
  });

  it("keeps the selected row across a re-broadcast", () => {
    useStore.getState().setShow(show("a"));
    useStore.getState().setSelectedRow("r2");
    useStore.getState().setShow(show("a"));
    expect(useStore.getState().selectedRowId).toBe("r2");
  });

  it("keeps a selected hotcard across a re-broadcast instead of reselecting row 1", () => {
    useStore.getState().setShow(show("a"));
    useStore.getState().setSelectedHotcard("h1");
    useStore.getState().setShow(show("a"));
    expect(useStore.getState().selectedHotcardId).toBe("h1");
    expect(useStore.getState().selectedRowId).toBeNull();
  });
});

describe("adoptRequestedShow", () => {
  it("ignores another show's broadcast while one is loaded", () => {
    useStore.getState().setShow(show("a"));
    expect(useStore.getState().adoptRequestedShow(show("b"))).toBe(false);
    expect(useStore.getState().show?.id).toBe("a");
  });

  it("adopts the show the operator asked for, then forgets the request", () => {
    useStore.getState().setShow(show("a"));
    useStore.getState().setRequestedShowId("b");
    expect(useStore.getState().adoptRequestedShow(show("b"))).toBe(true);
    expect(useStore.getState().show?.id).toBe("b");
    expect(useStore.getState().requestedShowId).toBeNull();
  });

  it("leaves a same-id broadcast to the ws handler", () => {
    useStore.getState().setShow(show("a"));
    expect(useStore.getState().adoptRequestedShow(show("a"))).toBe(false);
  });
});
