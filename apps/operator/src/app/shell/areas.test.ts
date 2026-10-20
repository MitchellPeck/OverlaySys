import { describe, it, expect } from "vitest";
import {
  AREAS, AREA_ORDER, LEGACY_REDIRECTS, areasFor, defaultRouteFor, destinationsFor,
  lastRouteKey, liveToggleTarget, routeToArea,
} from "./areas";

describe("areas model", () => {
  it("maps the console to live", () => {
    expect(routeToArea("/")).toBe("live");
  });

  it("maps library routes, including nested editors", () => {
    for (const p of ["/shows", "/shows/edit", "/songs", "/songs/edit", "/design", "/design/edit", "/hotcards", "/hotcards/edit"]) {
      expect(routeToArea(p), p).toBe("library");
    }
  });

  it("maps settings routes, including ones without a /settings prefix", () => {
    for (const p of ["/settings/channels", "/settings/stt", "/pco", "/data", "/projects", "/account"]) {
      expect(routeToArea(p), p).toBe("settings");
    }
  });

  it("does not treat '/' as a prefix of everything", () => {
    expect(routeToArea("/projects")).toBe("settings");
  });

  it("falls back to library for unknown routes", () => {
    expect(routeToArea("/nonsense")).toBe("library");
  });

  it("hides live and desktop-only settings in the cloud build", () => {
    expect(areasFor(true)).toEqual(["library", "settings"]);
    expect(areasFor(false)).toEqual(["live", "library", "settings"]);
    expect(destinationsFor("settings", true).map((d) => d.route)).toEqual(["/data", "/projects", "/account"]);
    expect(destinationsFor("settings", false).map((d) => d.route)).toEqual([
      "/settings/channels", "/settings/stt", "/pco", "/data", "/projects", "/account",
    ]);
  });

  it("has a default route that is visible in each build", () => {
    expect(defaultRouteFor("live", false)).toBe("/");
    expect(defaultRouteFor("library", true)).toBe("/shows");
    expect(defaultRouteFor("settings", false)).toBe("/settings/channels");
    expect(defaultRouteFor("settings", true)).toBe("/data");
  });

  it("redirects the old live-tool routes", () => {
    expect(LEGACY_REDIRECTS).toEqual({
      "/timer": "/",
      "/channels": "/settings/channels",
      "/stt": "/settings/stt",
    });
  });

  it("uses per-area last-route keys", () => {
    expect(lastRouteKey("library")).toBe("overlaysys:lastRoute:library");
  });

  it("⌘⇧L goes to Live from elsewhere and back to the last non-live route from Live", () => {
    expect(liveToggleTarget("library", "/songs", false)).toBe("/");
    expect(liveToggleTarget("live", "/songs/edit", false)).toBe("/songs/edit");
    expect(liveToggleTarget("live", null, false)).toBe("/shows");
  });

  it("⌘⇧L in cloud returns to the last non-live route", () => {
    expect(liveToggleTarget("library", "/songs", true)).toBe("/songs");
    expect(liveToggleTarget("library", null, true)).toBe("/shows");
  });

  it("lists areas in tab order", () => {
    expect(AREA_ORDER).toEqual(["live", "library", "settings"]);
    expect(AREAS.library.destinations.map((d) => d.label)).toEqual(["Shows", "Songs", "Designs", "Hotcards"]);
  });
});
