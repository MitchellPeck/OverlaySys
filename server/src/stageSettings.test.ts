import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadStageSettings, saveStageSettings, registerStageSettingsRoutes } from "./stageSettings";

const ITEM_DEFAULTS = { autoItemTimer: true, itemTimerOvertime: true };

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
    expect(await loadStageSettings()).toEqual({ messagePresets: ["Wrap up", "5 minutes", "Stand by"], ...ITEM_DEFAULTS });
  });

  it("round-trips", async () => {
    await saveStageSettings({ messagePresets: ["Hello", "World"], ...ITEM_DEFAULTS });
    expect(await loadStageSettings()).toEqual({ messagePresets: ["Hello", "World"], ...ITEM_DEFAULTS });
  });

  it("trims and drops blanks on save", async () => {
    expect(await saveStageSettings({ messagePresets: ["  A ", ""], ...ITEM_DEFAULTS })).toEqual({ messagePresets: ["A"], ...ITEM_DEFAULTS });
    expect(await loadStageSettings()).toEqual({ messagePresets: ["A"], ...ITEM_DEFAULTS });
  });

  it("GET/PUT routes", async () => {
    const app = Fastify();
    await registerStageSettingsRoutes(app);
    await app.ready();
    expect((await app.inject({ method: "GET", url: "/api/stage/settings" })).json()).toEqual({
      messagePresets: ["Wrap up", "5 minutes", "Stand by"],
      ...ITEM_DEFAULTS,
    });
    const put = await app.inject({ method: "PUT", url: "/api/stage/settings", payload: { messagePresets: [" X "] } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ messagePresets: ["X"], ...ITEM_DEFAULTS });
    const bad = await app.inject({ method: "PUT", url: "/api/stage/settings", payload: { messagePresets: 5 } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});
