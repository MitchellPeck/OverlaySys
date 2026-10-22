import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadScriptureSettings, saveScriptureSettings } from "./scriptureSettings";
import { registerScriptureRoutes } from "./scripture";

let tmp: string;
let prev: string | undefined;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-scrset-"));
  prev = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmp;
});
afterEach(async () => {
  if (prev === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prev;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("scripture settings", () => {
  it("missing file → {} (Review Focus 4)", async () => {
    expect(await loadScriptureSettings()).toEqual({});
  });

  it("corrupt file → {}", async () => {
    await fs.mkdir(path.join(tmp, "settings"), { recursive: true });
    await fs.writeFile(path.join(tmp, "settings", "scripture.json"), "{not json");
    expect(await loadScriptureSettings()).toEqual({});
  });

  it("round-trips", async () => {
    await saveScriptureSettings({ introTemplateId: "i", introFieldMap: { title: "reference" } });
    expect(await loadScriptureSettings()).toEqual({ introTemplateId: "i", introFieldMap: { title: "reference" } });
  });

  it("GET/PUT routes", async () => {
    const app = Fastify();
    await registerScriptureRoutes(app);
    await app.ready();
    expect((await app.inject({ method: "GET", url: "/api/scripture/settings" })).json()).toEqual({});
    const put = await app.inject({ method: "PUT", url: "/api/scripture/settings", payload: { introTemplateId: "i" } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ introTemplateId: "i" });
    const bad = await app.inject({ method: "PUT", url: "/api/scripture/settings", payload: { introTemplateId: 5 } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/scripture/settings" })).json()).toEqual({ introTemplateId: "i" });
    await app.close();
  });
});
