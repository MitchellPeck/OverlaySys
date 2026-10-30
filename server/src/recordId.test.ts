import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChannelConfig, Deck, Hotcard, Project, Show, Song, Template } from "@overlaysys/core";
import { assertSafeRecordId, isSafeRecordId, recordFile } from "./recordId";
import * as storage from "./storage";
import { loadDeck, writeDeck } from "./decksStore";

const UNSAFE = ["", ".", "..", ".hidden", "../stt/config", "a/b", "a\\b", "..\\stt\\config", "a\0b", "/etc/passwd"];
// Shapes the app generates: prefixed short uuids, title slugs, channel names, full uuids.
const SAFE = [
  "template-49ff73b5",
  "be-thou-my-vision",
  "show-0a59dfb3",
  "alpha-program",
  "3f2b8c1e-9d4a-4b7e-8c2f-1a2b3c4d5e6f",
  "default",
  "song_87313d19",
];

describe("record id guard", () => {
  it.each(UNSAFE)("rejects %j", (id) => {
    expect(isSafeRecordId(id)).toBe(false);
    expect(() => assertSafeRecordId(id)).toThrow(/record id/i);
  });

  it.each(SAFE)("accepts %j", (id) => {
    expect(isSafeRecordId(id)).toBe(true);
    expect(() => assertSafeRecordId(id)).not.toThrow();
  });

  it("rejects non-strings", () => {
    expect(isSafeRecordId(undefined)).toBe(false);
    expect(isSafeRecordId(42)).toBe(false);
  });

  it("an unsafe id carries a 400 status for HTTP callers", () => {
    try {
      assertSafeRecordId("../x");
      expect.unreachable();
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(400);
    }
  });

  it("recordFile resolves inside its directory", () => {
    const dir = path.resolve("/data/songs");
    expect(recordFile(dir, "be-thou-my-vision")).toBe(path.join(dir, "be-thou-my-vision.json"));
    expect(() => recordFile(dir, "../stt/config")).toThrow(/record id/i);
  });
});

describe("file-backed stores refuse ids that escape their directory", () => {
  let tmp: string;
  let prevData: string | undefined;
  const sttConfig = (): string => path.join(tmp, "stt", "config.json");
  const exists = (p: string): Promise<boolean> =>
    fs.stat(p).then(
      () => true,
      () => false,
    );

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-recid-"));
    prevData = process.env["OVERLAYSYS_DATA_DIR"];
    process.env["OVERLAYSYS_DATA_DIR"] = tmp;
  });
  afterEach(async () => {
    await storage._settleWritesForTest();
    await fs.rm(tmp, { recursive: true, force: true });
    if (prevData === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
    else process.env["OVERLAYSYS_DATA_DIR"] = prevData;
  });

  const evil = "../stt/config";

  it("decks", async () => {
    const deck = { id: evil, name: "x", tags: [], slides: [], customCommand: "touch /tmp/pwned" } as unknown as Deck;
    await expect(writeDeck(deck)).rejects.toThrow(/record id/i);
    expect(await exists(sttConfig())).toBe(false);
    expect(await loadDeck(evil)).toBeNull();
  });

  it("templates, shows, songs, hotcards, channels and projects", async () => {
    const rec = { id: evil, customCommand: "touch /tmp/pwned" };
    await expect(storage.saveTemplate(rec as unknown as Template)).rejects.toThrow(/record id/i);
    await expect(storage.saveShow(rec as unknown as Show)).rejects.toThrow(/record id/i);
    await expect(storage.saveSong(rec as unknown as Song)).rejects.toThrow(/record id/i);
    await expect(storage.saveHotcard(rec as unknown as Hotcard)).rejects.toThrow(/record id/i);
    await expect(storage.saveChannelConfig(rec as unknown as ChannelConfig)).rejects.toThrow(/record id/i);
    await expect(storage.saveProject(rec as unknown as Project)).rejects.toThrow(/record id/i);
    expect(await exists(sttConfig())).toBe(false);
  });

  it("gets and deletes with a traversal id touch nothing", async () => {
    await fs.mkdir(path.join(tmp, "stt"), { recursive: true });
    await fs.writeFile(sttConfig(), JSON.stringify({ id: "config" }));
    expect(await storage.loadSong(evil)).toBeNull();
    expect(await storage.loadTemplate(evil)).toBeNull();
    expect(await storage.deleteSong(evil)).toBe(false);
    expect(await storage.deleteHotcard(evil)).toBe(false);
    expect(await exists(sttConfig())).toBe(true);
  });

  it("ordinary ids still save and load", async () => {
    const song = {
      id: "be-thou-my-vision",
      title: "Be Thou My Vision",
      sections: [{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "s1", lines: ["Be thou my vision"] }] }],
      defaultArrangement: ["v1"],
    } as unknown as Song;
    await storage.saveSong(song);
    expect((await storage.loadSong("be-thou-my-vision"))?.title).toBe("Be Thou My Vision");

    const deck = {
      id: "3f2b8c1e-9d4a-4b7e-8c2f-1a2b3c4d5e6f",
      name: "Deck",
      tags: [],
      defaultTemplateId: "t",
      licensing: { kind: "own" },
      slides: [{ id: "s1", data: { text: "A" } }],
      createdAt: "2026-10-30T00:00:00.000Z",
    } as Deck;
    await writeDeck(deck);
    expect((await loadDeck(deck.id))?.name).toBe("Deck");
  });
});
