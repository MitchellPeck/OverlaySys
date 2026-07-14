import { describe, it, expect } from "vitest";
import { WORKSPACES, routeToWorkspace, destinationsFor } from "./workspaces";

describe("workspaces model", () => {
  it("maps live routes to the live workspace", () => {
    for (const p of ["/", "/timer", "/stt", "/channels"]) {
      expect(routeToWorkspace(p)).toBe("live");
    }
  });

  it("maps prep routes to the prep workspace", () => {
    for (const p of ["/projects", "/shows", "/songs", "/design", "/hotcards", "/data"]) {
      expect(routeToWorkspace(p)).toBe("prep");
    }
  });

  it("resolves nested routes by longest prefix", () => {
    expect(routeToWorkspace("/shows/edit")).toBe("prep");
    expect(routeToWorkspace("/songs/edit")).toBe("prep");
    expect(routeToWorkspace("/design/edit")).toBe("prep");
  });

  it("treats '/' as Show exactly, not a prefix of everything", () => {
    // /projects must not resolve to live just because it starts after "/"
    expect(routeToWorkspace("/projects")).toBe("prep");
  });

  it("falls back to prep for unknown routes", () => {
    expect(routeToWorkspace("/account")).toBe("prep");
    expect(routeToWorkspace("/nonsense")).toBe("prep");
  });

  it("filters desktopOnly destinations in cloud mode", () => {
    // Live is entirely desktopOnly → empty in cloud
    expect(destinationsFor("live", true)).toHaveLength(0);
    expect(destinationsFor("live", false).map((d) => d.route)).toEqual([
      "/", "/timer", "/stt", "/channels",
    ]);
    // Prep is unaffected by cloud
    expect(destinationsFor("prep", true).map((d) => d.route)).toEqual([
      "/projects", "/shows", "/songs", "/design", "/hotcards", "/data",
    ]);
  });

  it("has a defaultRoute that is one of its destinations", () => {
    for (const id of ["live", "prep"] as const) {
      const ws = WORKSPACES[id];
      expect(ws.destinations.some((d) => d.route === ws.defaultRoute)).toBe(true);
    }
  });
});
