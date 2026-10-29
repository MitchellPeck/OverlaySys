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
vi.mock("./decks", () => ({ deckRegistrySnapshot: () => new Map() }));
vi.mock("./songs", () => ({ listSongs: async () => [] }));
vi.mock("./hotcards", () => ({
  listHotcardMetas: async () => [{ id: "h1", name: "Welcome", templateId: "lt" }],
}));
vi.mock("./scriptureSettings", () => ({ loadScriptureSettings: async () => ({}) }));
// [P2b.11] no disk: templates.ts loads an empty registry
vi.mock("./storage", () => ({
  ensureSeeded: async () => {},
  loadAllTemplates: async () => [],
  saveTemplate: async () => {},
}));
const broadcasts = vi.hoisted(() => [] as unknown[]);
vi.mock("./broadcast", () => ({ broadcast: (m: unknown) => broadcasts.push(m) }));
// [/P2b.11]

import { registerTemplateRoutes } from "./templateRoutes";
// [P2b.11]
import * as channels from "./channels";
import * as templates from "./templates";
// [/P2b.11]

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
      decks: [],
      scriptureDefault: false,
      protected: false,
    });
    const builtin = await app.inject({ method: "GET", url: "/api/templates/lyric-default/usage" });
    expect(builtin.json().protected).toBe(true);
  });
});

// [P2b.11] draft preview
const draftTpl = {
  id: "lt",
  name: "Lower third",
  size: { w: 1920, h: 1080 },
  fields: [],
  layers: [],
  timelines: { in: { duration: 0, tracks: [] }, out: { duration: 0, tracks: [] } },
  fonts: [],
};

describe("draft preview routes", () => {
  it("POST stores the draft, broadcasts it and cues it on preview", async () => {
    const app = Fastify();
    await registerTemplateRoutes(app);
    broadcasts.length = 0;
    const res = await app.inject({
      method: "POST",
      url: "/api/templates/draft-preview",
      payload: { template: draftTpl, data: { name: "Ada" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, draftId: "__draft__lt" });
    expect((await templates.getTemplate("__draft__lt"))?.name).toBe("Lower third");
    expect(broadcasts).toContainEqual({ type: "template", template: expect.objectContaining({ id: "__draft__lt" }) });
    expect(channels.getState("preview").active?.templateId).toBe("__draft__lt");
    expect(channels.getState("preview").active?.data).toEqual({ name: "Ada" });
  });

  it("ignores a channel in the body: always preview", async () => {
    const app = Fastify();
    await registerTemplateRoutes(app);
    channels.setActiveNull("program");
    channels.setActiveNull("preview");
    const res = await app.inject({
      method: "POST",
      url: "/api/templates/draft-preview",
      payload: { template: draftTpl, data: {}, channel: "program" },
    });
    expect(res.statusCode).toBe(200);
    expect(channels.getState("preview").active?.templateId).toBe("__draft__lt");
    expect(channels.getState("program").active).toBeNull();
  });

  it("POST with an invalid template is a 400 that names the op", async () => {
    const app = Fastify();
    await registerTemplateRoutes(app);
    const res = await app.inject({
      method: "POST",
      url: "/api/templates/draft-preview",
      payload: { template: { id: "lt" }, data: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, op: "draft_preview" });
  });

  it("DELETE clears preview when it shows that draft, then drops the draft", async () => {
    const app = Fastify();
    await registerTemplateRoutes(app);
    await app.inject({ method: "POST", url: "/api/templates/draft-preview", payload: { template: draftTpl, data: {} } });
    const res = await app.inject({ method: "DELETE", url: "/api/templates/draft-preview/lt" });
    expect(res.json()).toEqual({ ok: true });
    expect(channels.getState("preview").active?.phase).toBe("out");
    expect(await templates.getTemplate("__draft__lt")).toBeNull();
  });

  it("DELETE leaves preview alone when it shows something else", async () => {
    const app = Fastify();
    await registerTemplateRoutes(app);
    channels.setActiveNull("preview");
    channels.take("preview", "other", {});
    const res = await app.inject({ method: "DELETE", url: "/api/templates/draft-preview/lt" });
    expect(res.json()).toEqual({ ok: true });
    expect(channels.getState("preview").active?.templateId).toBe("other");
    expect(channels.getState("preview").active?.phase).toBe("in");
  });
});
// [/P2b.11]
