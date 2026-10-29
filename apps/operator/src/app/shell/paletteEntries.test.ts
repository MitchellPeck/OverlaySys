import { describe, it, expect } from "vitest";
import type { ChannelState, Hotcard, HotcardMeta, TemplateMeta } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import type { ShowMeta } from "../../lib/store";
import { liveCommands, type PaletteCommand } from "../../lib/liveCommands";
import { SYNONYMS, buildPaletteEntries, rankEntries, runPaletteEntry, toPaletteEntry, type PaletteEntry } from "./paletteEntries";

const welcome: Hotcard = { id: "h1", name: "Welcome", projectId: "p1", templateId: "l3", data: { title: "Line one" }, channelHint: "program" };
const hotcardMetas: HotcardMeta[] = [
  { id: "h1", name: "Welcome", projectId: "p1", templateId: "l3", channelHint: "program" },
  { id: "h2", name: "Elsewhere", projectId: "p2", templateId: "l3" },
];
const liveState = {
  channelStates: {
    program: { channel: "program", active: { templateId: "l3", data: {} } },
    preview: { channel: "preview", active: { templateId: "l3", data: {} } },
  } as unknown as Record<string, ChannelState>,
  hotcards: hotcardMetas,
  hotcardCache: { h1: welcome },
  currentProjectId: "p1",
  show: null,
};

const destinations = [
  { label: "Library · Shows", href: "/shows" },
  { label: "Library · Songs", href: "/songs" },
  { label: "Library · Planning Center", href: "/pco" },
  { label: "Settings · Channels", href: "/settings/channels" },
  { label: "Settings · Speech-to-text", href: "/settings/stt" },
  { label: "Settings · Scripture", href: "/settings/scripture" },
  { label: "Settings · Stage monitor", href: "/settings/stage" },
];
const shows: ShowMeta[] = [
  { id: "s1", name: "Sunday Service", projectId: "p1", rowCount: 4 },
  { id: "s2", name: "Other Project Show", projectId: "p2", rowCount: 1 },
];
const songs = [{ id: "g1", title: "Placeholder Song", author: "Someone" }];
const templates = [{ id: "t1", name: "Lower third", size: { w: 1920, h: 1080 } }] as unknown as TemplateMeta[];
const stageLayouts = [{ id: "st1", name: "Pastor view", size: { w: 1920, h: 1080 }, builtIn: false }];

function build(cloud: boolean, extras: PaletteEntry[] = []) {
  return buildPaletteEntries({
    destinations, shows, songs, templates, stageLayouts, hotcards: hotcardMetas, projectId: "p1", cloud, extras,
  });
}

const onAirExtras = (send: (m: ClientMessage) => void = () => {}) =>
  liveCommands(liveState).map((c) => toPaletteEntry(c, send));

describe("SYNONYMS", () => {
  it("has the agreed table", () => {
    expect(SYNONYMS).toEqual({
      stt: ["speech-to-text"], pvw: ["preview"], pgm: ["program"], lyrics: ["songs"], graphics: ["designs", "templates"],
    });
  });
});

describe("rankEntries", () => {
  it("puts Speech-to-text first for 'stt'", () => {
    expect(rankEntries("stt", build(false, onAirExtras()))[0]?.label).toBe("Settings · Speech-to-text");
  });
  it("orders by score, then group; Go to / App / On air keep their given (nav) order", () => {
    const e = (label: string, group: PaletteEntry["group"]): PaletteEntry => ({ id: label + group, label, group });
    const ranked = rankEntries("so", [e("Zed so", "App"), e("Songs", "Go to"), e("Sonic", "Songs"), e("Also", "Go to"), e("Solo", "Go to")]);
    expect(ranked.map((r) => r.label)).toEqual(["Songs", "Solo", "Sonic", "Zed so", "Also"]);
  });
  it("library groups sort by label within a score", () => {
    const e = (label: string, group: PaletteEntry["group"]): PaletteEntry => ({ id: label + group, label, group });
    const ranked = rankEntries("", [e("Settings", "Go to"), e("Live", "Go to"), e("Zion", "Songs"), e("Amazing", "Songs"), e("Take", "On air"), e("Clear", "On air")]);
    expect(ranked.map((r) => r.label)).toEqual(["Settings", "Live", "Amazing", "Zion", "Take", "Clear"]);
  });
  it("caps the result list", () => {
    const many = Array.from({ length: 120 }, (_, i): PaletteEntry => ({ id: String(i), label: "Song " + i, group: "Songs" }));
    expect(rankEntries("song", many, 50)).toHaveLength(50);
    expect(rankEntries("song", many)).toHaveLength(120);
  });
  it("drops entries that don't match and matches keywords", () => {
    const ranked = rankEntries("pgm", build(false, onAirExtras()));
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((r) => /program/i.test(r.label) || (r.keywords ?? []).includes("pgm"))).toBe(true);
  });
  it("finds library items by name", () => {
    expect(rankEntries("sunday", build(false))[0]).toMatchObject({ group: "Shows", href: "/shows/edit?id=s1" });
    expect(rankEntries("pastor", build(false))[0]).toMatchObject({ group: "Designs", href: "/design/stage/edit?id=st1" });
  });
});

describe("buildPaletteEntries", () => {
  it("lists library items with their editor links, current project only", () => {
    const entries = build(false);
    const hrefs = entries.map((x) => x.href);
    expect(hrefs).toContain("/shows/edit?id=s1");
    expect(hrefs).not.toContain("/shows/edit?id=s2");
    expect(hrefs).toContain("/songs/edit?id=g1");
    expect(hrefs).toContain("/design/edit?id=t1");
    expect(hrefs).toContain("/hotcards/edit?id=h1");
    expect(hrefs).not.toContain("/hotcards/edit?id=h2");
    expect(entries.find((x) => x.href === "/settings/stt")?.group).toBe("Go to");
  });
  it("every On air entry has a confirm", () => {
    const air = build(false, onAirExtras()).filter((x) => x.group === "On air");
    expect(air.length).toBeGreaterThanOrEqual(6);
    for (const x of air) expect(x.confirm).toBeTruthy();
  });
  it("has no On air entries in cloud mode", () => {
    expect(build(true, onAirExtras()).some((x) => x.group === "On air")).toBe(false);
  });
});

describe("toPaletteEntry", () => {
  it("keeps confirm and sends messages() in order when run", () => {
    const msgs = [{ type: "clear", channel: "program" }, { type: "clear", channel: "preview" }] as unknown as ClientMessage[];
    let calls = 0;
    const cmd: PaletteCommand = {
      id: "clear-all", label: "Clear all outputs", group: "On air", keywords: ["clear"],
      confirm: { title: "Clear all outputs?", message: "m", confirmLabel: "Clear all" },
      messages: () => { calls++; return msgs; },
    };
    const sent: ClientMessage[] = [];
    const entry = toPaletteEntry(cmd, (m) => sent.push(m));
    expect(entry).toMatchObject({ id: "clear-all", label: "Clear all outputs", group: "On air", keywords: ["clear"], confirm: cmd.confirm });
    expect(calls).toBe(0); // not read until sent
    entry.run?.();
    expect(calls).toBe(1);
    expect(sent).toEqual(msgs);
  });

  it("reports an empty send instead of doing nothing silently", () => {
    const cmd: PaletteCommand = {
      id: "take-pvw", label: "Take preview to program", group: "On air", keywords: [],
      confirm: { title: "t", message: "m", confirmLabel: "Take" },
      messages: () => [],
    };
    const empty: string[] = [];
    toPaletteEntry(cmd, () => { throw new Error("nothing should be sent"); }, (c) => empty.push(c.id)).run?.();
    expect(empty).toEqual(["take-pvw"]);
  });
});

describe("runPaletteEntry", () => {
  const cmd = (msgs: () => ClientMessage[]): PaletteCommand => ({
    id: "clear-all", label: "Clear all outputs", group: "On air", keywords: [],
    confirm: { title: "Clear all outputs?", message: "m", confirmLabel: "Clear all", danger: true },
    messages: msgs,
  });

  it("cancel at the confirm sends nothing and never reads messages()", async () => {
    let reads = 0;
    const sent: ClientMessage[] = [];
    const entry = toPaletteEntry(cmd(() => { reads++; return [{ type: "clear", channel: "program" } as ClientMessage]; }), (m) => sent.push(m));
    const asked: unknown[] = [];
    const r = await runPaletteEntry(entry, { confirm: async (c) => { asked.push(c); return false; }, navigate: () => { throw new Error("no nav"); } });
    expect(r).toBe("cancelled");
    expect(asked).toEqual([entry.confirm]);
    expect(reads).toBe(0);
    expect(sent).toEqual([]);
  });

  it("confirm then sends; links navigate without a confirm", async () => {
    const sent: ClientMessage[] = [];
    const entry = toPaletteEntry(cmd(() => [{ type: "clear", channel: "program" } as ClientMessage]), (m) => sent.push(m));
    expect(await runPaletteEntry(entry, { confirm: async () => true, navigate: () => {} })).toBe("ran");
    expect(sent).toHaveLength(1);
    const went: string[] = [];
    const link: PaletteEntry = { id: "go", label: "Songs", group: "Go to", href: "/songs" };
    expect(await runPaletteEntry(link, { confirm: async () => { throw new Error("no confirm"); }, navigate: (h) => went.push(h) })).toBe("navigated");
    expect(went).toEqual(["/songs"]);
  });
});
