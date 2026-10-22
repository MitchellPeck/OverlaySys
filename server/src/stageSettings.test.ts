import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadStageSettings, saveStageSettings, registerStageSettingsRoutes } from "./stageSettings";

let tmp: string;
let prev: string | undefined;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-stgset-"));
  prev = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmp;
});
afterEach(async () => {
  if (prev === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prev;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("stage settings", () => {
  it("missing file → default presets", async () => {
    expect(await loadStageSettings()).toEqual({ messagePresets: ["Wrap up", "5 minutes", "Stand by"] });
  });

  it("round-trips", async () => {
    await saveStageSettings({ messagePresets: ["Hello", "World"] });
    expect(await loadStageSettings()).toEqual({ messagePresets: ["Hello", "World"] });
  });

  it("trims and drops blanks on save", async () => {
    expect(await saveStageSettings({ messagePresets: ["  A ", ""] })).toEqual({ messagePresets: ["A"] });
    expect(await loadStageSettings()).toEqual({ messagePresets: ["A"] });
  });

  it("GET/PUT routes", async () => {
    const app = Fastify();
    await registerStageSettingsRoutes(app);
    await app.ready();
    expect((await app.inject({ method: "GET", url: "/api/stage/settings" })).json()).toEqual({
      messagePresets: ["Wrap up", "5 minutes", "Stand by"],
    });
    const put = await app.inject({ method: "PUT", url: "/api/stage/settings", payload: { messagePresets: [" X "] } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ messagePresets: ["X"] });
    const bad = await app.inject({ method: "PUT", url: "/api/stage/settings", payload: { messagePresets: 5 } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});
