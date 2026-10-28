import { describe, expect, it } from "vitest";
import { bodyStatus, clearInFlightOnDisconnect } from "./templateBodyState";

describe("bodyStatus", () => {
  it("an empty but loaded list reports missing, not loading", () => {
    expect(bodyStatus({ hasBody: false, listLoaded: true, inList: false })).toBe("missing");
  });
  it("loading until the list arrives; ready wins", () => {
    expect(bodyStatus({ hasBody: false, listLoaded: false, inList: false })).toBe("loading");
    expect(bodyStatus({ hasBody: false, listLoaded: true, inList: true })).toBe("loading");
    expect(bodyStatus({ hasBody: true, listLoaded: true, inList: false })).toBe("ready");
  });
});

describe("clearInFlightOnDisconnect", () => {
  it("forgets outstanding requests when conn leaves open", () => {
    const s = new Set(["a"]);
    clearInFlightOnDisconnect("open", s);
    expect(s.size).toBe(1);
    clearInFlightOnDisconnect("closed", s);
    expect(s.size).toBe(0);
  });
});
