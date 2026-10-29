import { describe, expect, it } from "vitest";
import { listLoadState } from "./listLoadState";

describe("listLoadState", () => {
  it("connecting is loading, never an error", () => {
    expect(listLoadState({ conn: "connecting", loaded: false })).toEqual({ loading: true, error: false });
    expect(listLoadState({ conn: "connecting", loaded: true })).toEqual({ loading: true, error: false });
  });
  it("open before the first list is loading", () => {
    expect(listLoadState({ conn: "open", loaded: false })).toEqual({ loading: true, error: false });
  });
  it("open with a list is neither", () => {
    expect(listLoadState({ conn: "open", loaded: true })).toEqual({ loading: false, error: false });
  });
  it("closed is an error", () => {
    expect(listLoadState({ conn: "closed", loaded: true })).toEqual({ loading: false, error: true });
  });
  it("cloud ignores the socket", () => {
    expect(listLoadState({ cloud: true, conn: "closed", loaded: false })).toEqual({ loading: true, error: false });
    expect(listLoadState({ cloud: true, conn: "closed", loaded: true })).toEqual({ loading: false, error: false });
  });
});
