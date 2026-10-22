import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Show, ScriptureRow } from "@overlaysys/core";
import * as shows from "./shows";
import * as templates from "./templates";
import * as channels from "./channels";
import * as scriptureSession from "./scriptureSession";
import { saveScriptureSettings } from "./scriptureSettings";
import { handleScriptureMessage } from "./scriptureHandlers";

const row = {
  kind: "scripture", id: "r1", reference: "John 3:16", translation: "KJV", templateId: "body",
  channelHint: "lower", slides: [{ id: "slide-0", verses: [{ book: "JHN", chapter: 3, verse: 16, text: "For God" }] }],
} as ScriptureRow;
const show = { id: "show1", name: "S", projectId: "p", rows: [row], songs: [] } as unknown as Show;
const introTpl = { id: "intro", name: "Intro", fields: [{ key: "title", label: "Title", type: "text" }, { key: "book", label: "Book", type: "text" }] };

let tmp: string;
let prev: string | undefined;
let sent: unknown[];
const send = (m: unknown) => sent.push(m);

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-scrh-"));
  prev = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmp;
  sent = [];
  scriptureSession.resetAll();
  vi.spyOn(shows, "getShow").mockImplementation(async (id) => (id === "show1" ? show : null));
  vi.spyOn(templates, "getTemplate").mockImplementation(async (id) => (id === "intro" ? (introTpl as never) : null));
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (prev === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prev;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("handleScriptureMessage", () => {
  it("intro with no default and no override → not_configured", async () => {
    await handleScriptureMessage({ type: "scripture_take_intro", showId: "show1", rowId: "r1" }, send);
    expect(sent).toEqual([{ type: "error", code: "not_configured", message: "No intro configured for this scripture row" }]);
  });

  it("intro uses the settings default, the row's channel hint, and fills book", async () => {
    await saveScriptureSettings({ introTemplateId: "intro", introFieldMap: { title: "reference", book: "book" } });
    await handleScriptureMessage({ type: "scripture_take_intro", showId: "show1", rowId: "r1" }, send);
    expect(sent).toEqual([]);
    const s = channels.getState("lower");
    expect(s.active?.data).toEqual({ title: "John 3:16", book: "John" });
    expect(s.queuedScripture?.rowId).toBe("r1");
  });

  it("explicit channel wins", async () => {
    await saveScriptureSettings({ introTemplateId: "intro" });
    await handleScriptureMessage({ type: "scripture_take_intro", showId: "show1", rowId: "r1", channel: "preview" }, send);
    expect(channels.getState("preview").queuedScripture?.rowId).toBe("r1");
  });

  it("unknown show / row / slide → not_found", async () => {
    await handleScriptureMessage({ type: "scripture_take_slide", showId: "nope", rowId: "r1", slideIdx: 0 }, send);
    await handleScriptureMessage({ type: "scripture_take_slide", showId: "show1", rowId: "nope", slideIdx: 0 }, send);
    await handleScriptureMessage({ type: "scripture_take_slide", showId: "show1", rowId: "r1", slideIdx: 4 }, send);
    expect(sent.map((m) => (m as { code: string }).code)).toEqual(["not_found", "not_found", "not_found"]);
  });

  it("slide, advance, goto and end route to the session", async () => {
    await handleScriptureMessage({ type: "scripture_take_slide", showId: "show1", rowId: "r1", slideIdx: 0, channel: "program" }, send);
    expect(channels.getState("program").scriptureSession?.rowId).toBe("r1");
    await handleScriptureMessage({ type: "scripture_goto", channel: "program", slideIdx: 0 }, send);
    await handleScriptureMessage({ type: "scripture_advance", channel: "program", delta: 1 }, send);
    await handleScriptureMessage({ type: "scripture_end", channel: "program" }, send);
    expect(channels.getState("program").scriptureSession).toBeUndefined();
    expect(sent).toEqual([]);
  });
});
