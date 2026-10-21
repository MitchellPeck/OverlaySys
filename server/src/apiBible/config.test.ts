import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FetchLike } from "@overlaysys/scripture";
import { initScripture, registerScriptureRoutes, getScriptureRegistry } from "../scripture";
import { _setApiBibleFetchForTest, ensureApiBible, getApiBibleStatus, initApiBible } from "./config";
import { registerApiBibleRoutes } from "./routes";
import { _setFumsFetchForTest } from "./fums";

const KEY = "secret-key-123";
let tmp: string;
let prevDir: string | undefined;
let prevKey: string | undefined;
let mode: "ok" | "rejected" | "offline" | "no_niv" = "ok";
const fumsCalls: string[] = [];

const fake: FetchLike = async (url, init) => {
  if (mode === "offline") throw new TypeError("fetch failed");
  if (mode === "rejected" || init?.headers?.["api-key"] !== KEY) return { status: 401, ok: false, json: async () => ({}) };
  if (url.includes("/bibles?abbreviation=NIV")) {
    const data = mode === "no_niv" ? [] : [{ id: "B", abbreviation: "NIV11", abbreviationLocal: "NIV" }];
    return { status: 200, ok: true, json: async () => ({ data }) };
  }
  if (url.includes("/passages/JHN.3.16-JHN.3.16")) {
    return { status: 200, ok: true, json: async () => ({ data: { content: "[16] For God so loved the world", copyright: "©" }, meta: { fumsToken: "tok" } }) };
  }
  return { status: 404, ok: false, json: async () => ({}) };
};

async function app() {
  const a = Fastify();
  await registerScriptureRoutes(a);
  await registerApiBibleRoutes(a);
  await a.ready();
  return a;
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-apibible-"));
  prevDir = process.env["OVERLAYSYS_DATA_DIR"];
  prevKey = process.env["OVERLAYSYS_API_BIBLE_KEY"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmp;
  delete process.env["OVERLAYSYS_API_BIBLE_KEY"];
  mode = "ok";
  fumsCalls.length = 0;
  _setApiBibleFetchForTest(fake);
  _setFumsFetchForTest(async (u) => { fumsCalls.push(u); return {}; });
  await initScripture();
  await initApiBible();
});
afterEach(async () => {
  _setApiBibleFetchForTest(undefined);
  _setFumsFetchForTest(null);
  if (prevDir === undefined) delete process.env["OVERLAYSYS_DATA_DIR"]; else process.env["OVERLAYSYS_DATA_DIR"] = prevDir;
  if (prevKey === undefined) delete process.env["OVERLAYSYS_API_BIBLE_KEY"]; else process.env["OVERLAYSYS_API_BIBLE_KEY"] = prevKey;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("API.Bible config", () => {
  it("starts with no key and no NIV", async () => {
    expect(getApiBibleStatus()).toEqual({ configured: false, source: null, state: "no_key" });
    expect(getScriptureRegistry().providerFor("NIV")).toBeNull();
  });

  it("PUT a good key saves it 0600, registers NIV, never echoes the key", async () => {
    const a = await app();
    const res = await a.inject({ method: "PUT", url: "/api/scripture/api-bible", payload: { apiKey: KEY } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(KEY);
    expect(res.json()).toMatchObject({ configured: true, source: "file", state: "ok", bibleId: "B" });
    const file = path.join(tmp, "settings", "api-bible.json");
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ apiKey: KEY });
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    const t = await a.inject({ method: "GET", url: "/api/scripture/translations" });
    expect(t.json().translations.map((x: { id: string }) => x.id)).toContain("NIV");
    const status = await a.inject({ method: "GET", url: "/api/scripture/api-bible" });
    expect(status.body).not.toContain(KEY);
    await a.close();
  });

  it("PUT a rejected key returns 400 and writes nothing", async () => {
    const a = await app();
    const res = await a.inject({ method: "PUT", url: "/api/scripture/api-bible", payload: { apiKey: "wrong" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().state).toBe("rejected");
    await expect(fs.stat(path.join(tmp, "settings", "api-bible.json"))).rejects.toThrow();
    await a.close();
  });

  it("env key wins; PUT/DELETE return 409", async () => {
    process.env["OVERLAYSYS_API_BIBLE_KEY"] = KEY;
    await initApiBible();
    expect(getApiBibleStatus()).toMatchObject({ source: "env", state: "ok" });
    const a = await app();
    expect((await a.inject({ method: "PUT", url: "/api/scripture/api-bible", payload: { apiKey: "x" } })).statusCode).toBe(409);
    expect((await a.inject({ method: "DELETE", url: "/api/scripture/api-bible" })).statusCode).toBe(409);
    await a.close();
  });

  it("DELETE removes the file and NIV", async () => {
    const a = await app();
    await a.inject({ method: "PUT", url: "/api/scripture/api-bible", payload: { apiKey: KEY } });
    const res = await a.inject({ method: "DELETE", url: "/api/scripture/api-bible" });
    expect(res.json()).toMatchObject({ configured: false, state: "no_key" });
    expect(getScriptureRegistry().providerFor("NIV")).toBeNull();
    await a.close();
  });

  it("no NIV on the key → state no_niv, nothing registered", async () => {
    mode = "no_niv";
    const a = await app();
    const res = await a.inject({ method: "PUT", url: "/api/scripture/api-bible", payload: { apiKey: KEY } });
    expect(res.json().state).toBe("no_niv");
    expect(getScriptureRegistry().providerFor("NIV")).toBeNull();
    await a.close();
  });

  it("offline at startup recovers via ensureApiBible after 60 s", async () => {
    await fs.mkdir(path.join(tmp, "settings"), { recursive: true });
    await fs.writeFile(path.join(tmp, "settings", "api-bible.json"), JSON.stringify({ apiKey: KEY }));
    mode = "offline";
    await initApiBible();
    expect(getApiBibleStatus().state).toBe("offline");
    mode = "ok";
    await ensureApiBible(Date.now()); // within 60 s of the failed init → no retry
    expect(getApiBibleStatus().state).toBe("offline");
    await ensureApiBible(Date.now() + 61_000);
    expect(getApiBibleStatus().state).toBe("ok");
  });

  it("passage route returns source + fetchedAt and reports FUMS", async () => {
    const a = await app();
    await a.inject({ method: "PUT", url: "/api/scripture/api-bible", payload: { apiKey: KEY } });
    const res = await a.inject({ method: "GET", url: "/api/scripture/passage?ref=John%203:16&translation=NIV" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toMatchObject({ provider: "api.bible", bibleId: "B", usageTokens: ["tok"] });
    expect(typeof body.source.fetchedAt).toBe("string");
    await new Promise((r) => setTimeout(r, 10));
    expect(fumsCalls.some((u) => u.includes("t=tok"))).toBe(true);
    await a.close();
  });

  it("passage route maps offline to 503 with the operator message", async () => {
    const a = await app();
    await a.inject({ method: "PUT", url: "/api/scripture/api-bible", payload: { apiKey: KEY } });
    mode = "offline";
    const res = await a.inject({ method: "GET", url: "/api/scripture/passage?ref=John%203:16&translation=NIV" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "offline", message: "Couldn't reach API.Bible" });
    await a.close();
  });

  it("POST /api/scripture/usage reports string tokens only", async () => {
    const a = await app();
    const res = await a.inject({ method: "POST", url: "/api/scripture/usage", payload: { tokens: ["x", 5, ""] } });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(fumsCalls).toHaveLength(1);
    expect(fumsCalls[0]).toContain("t=x");
    expect(fumsCalls[0]).not.toContain("t=5");
    await a.close();
  });
});
