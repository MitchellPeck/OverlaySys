import { describe, expect, it, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { initScripture, registerScriptureRoutes } from "./scripture";

let app: FastifyInstance;

beforeAll(async () => {
  await initScripture();
  app = Fastify();
  await registerScriptureRoutes(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("scripture e2e", () => {
  it("returns John 3:16 KJV with attribution", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/scripture/passage?ref=John+3:16&translation=KJV",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.verses[0].text.toLowerCase()).toContain("god so loved");
    expect(body.attribution).toMatch(/Public Domain/i);
  });

  it("returns a multi-passage list in order", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/scripture/passage?ref=Rom+8:28%3B+1+Cor+13:4&translation=KJV",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const flat = body.verses.map(
      (v: { book: string; chapter: number; verse: number }) =>
        `${v.book} ${v.chapter}:${v.verse}`,
    );
    expect(flat).toEqual(["ROM 8:28", "1CO 13:4"]);
  });

  it("returns 400 on cross-chapter range with descending end", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/scripture/passage?ref=John+4:2-3:16&translation=KJV",
    });
    expect(res.statusCode).toBe(400);
  });
});
