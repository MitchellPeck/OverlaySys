import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

vi.mock("./shows", () => ({
  listShowMetas: async () => [{ id: "s1" }],
  getShow: async () => ({
    id: "s1",
    name: "Sunday",
    rows: [{ kind: "graphic", id: "r1", templateId: "lt" }],
    songs: [],
  }),
}));
vi.mock("./songs", () => ({ listSongs: async () => [] }));
vi.mock("./hotcards", () => ({
  listHotcardMetas: async () => [{ id: "h1", name: "Welcome", templateId: "lt" }],
}));
vi.mock("./scriptureSettings", () => ({ loadScriptureSettings: async () => ({}) }));

import { registerTemplateRoutes } from "./templateRoutes";

describe("GET /api/templates/:id/usage", () => {
  it("returns the usage shape", async () => {
    const app = Fastify();
    await registerTemplateRoutes(app);
    const res = await app.inject({ method: "GET", url: "/api/templates/lt/usage" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      shows: [{ id: "s1", name: "Sunday" }],
      hotcards: [{ id: "h1", name: "Welcome" }],
      songs: [],
      scriptureDefault: false,
      protected: false,
    });
    const builtin = await app.inject({ method: "GET", url: "/api/templates/lyric-default/usage" });
    expect(builtin.json().protected).toBe(true);
  });
});
