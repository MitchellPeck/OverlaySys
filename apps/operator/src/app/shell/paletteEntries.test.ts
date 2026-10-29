import { describe, it, expect } from "vitest";
import type { ChannelState, Hotcard, HotcardMeta, TemplateMeta } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import type { ShowMeta } from "../../lib/store";
import { liveCommands, type PaletteCommand } from "../../lib/liveCommands";
import { SYNONYMS, buildPaletteEntries, rankEntries, toPaletteEntry, type PaletteEntry } from "./paletteEntries";

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
  it("orders by score, then group, then label", () => {
    const e = (label: string, group: PaletteEntry["group"]): PaletteEntry => ({ id: label + group, label, group });
    const ranked = rankEntries("so", [e("Zed so", "App"), e("Songs", "Go to"), e("Sonic", "Songs"), e("Also", "Go to"), e("Solo", "Go to")]);
    expect(ranked.map((r) => r.label)).toEqual(["Solo", "Songs", "Sonic", "Zed so", "Also"]);
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
});
