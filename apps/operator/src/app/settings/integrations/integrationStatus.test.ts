import { describe, expect, it } from "vitest";
import { integrationStatus } from "./integrationStatus";

describe("integrationStatus", () => {
  it("not configured", () => {
    expect(integrationStatus({ configured: false, ok: null })).toEqual({ tone: "muted", label: "Not set up" });
    expect(integrationStatus({ configured: false, ok: false })).toEqual({ tone: "muted", label: "Not set up" });
  });
  it("configured and ok", () => {
    expect(integrationStatus({ configured: true, ok: true })).toEqual({ tone: "ok", label: "Connected" });
  });
  it("configured and not ok", () => {
    expect(integrationStatus({ configured: true, ok: false })).toEqual({ tone: "warn", label: "Set up, not responding" });
  });
  it("ok unknown", () => {
    expect(integrationStatus({ configured: true, ok: null })).toEqual({ tone: "muted", label: "Checking…" });
  });
});
