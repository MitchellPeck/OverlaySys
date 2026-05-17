import { describe, expect, it, beforeAll } from "vitest";
import Fastify from "fastify";
import { initScripture, registerScriptureRoutes, _getRegistryForTest } from "./scripture";

async function buildApp() {
  await initScripture();
  const app = Fastify();
  await registerScriptureRoutes(app);
  await app.ready();
  return app;
}

describe("scripture init", () => {
  beforeAll(async () => { await initScripture(); });

  it("registers KJV and WEB", () => {
    const r = _getRegistryForTest();
    const ids = r.listTranslations().map((t) => t.id).sort();
    expect(ids).toEqual(["KJV", "WEB"]);
  });
});

describe("GET /api/scripture/translations", () => {
  it("returns the registered translations", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/api/scripture/translations" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.translations).toBeInstanceOf(Array);
      const ids = body.translations.map((t: { id: string }) => t.id).sort();
      expect(ids).toEqual(["KJV", "WEB"]);
    } finally {
      await app.close();
    }
  });
});

describe("GET /api/scripture/passage", () => {
  it("returns verses for a valid reference", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/scripture/passage?ref=John+3:16&translation=KJV",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.reference).toMatch(/John/);
      expect(body.translation).toBe("KJV");
      expect(body.verses).toHaveLength(1);
      expect(body.verses[0].verse).toBe(16);
      expect(body.attribution).toMatch(/Public Domain/i);
    } finally {
      await app.close();
    }
  });

  it("returns 400 on parser failure", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/scripture/passage?ref=Foobar+1:1&translation=KJV",
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("parse_error");
      expect(body.hint).toMatch(/book/i);
    } finally {
      await app.close();
    }
  });

  it("returns 404 on unknown translation", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/scripture/passage?ref=John+3:16&translation=NIV",
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("returns 400 on chapter/verse out of range", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/scripture/passage?ref=John+99:1&translation=KJV",
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.hint.toLowerCase()).toContain("chapter");
    } finally {
      await app.close();
    }
  });

  it("returns a normalized reference string for the round-trip", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/scripture/passage?ref=Jn+3:16-17&translation=KJV",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // "Jn" should round-trip as "John"; range preserved.
      expect(body.reference).toBe("John 3:16-17");
      expect(body.verses.map((v: { verse: number }) => v.verse)).toEqual([16, 17]);
    } finally {
      await app.close();
    }
  });
});
