import { describe, expect, it } from "vitest";
import type { ChannelState, RowSource } from "@overlaysys/core";
import { createItemEndTracker, rowsOnAir } from "./itemEnd";

const src = (rowId: string): RowSource => ({ showId: "sh", rowId });
const graphic = (phase: "in" | "out", outReason?: "auto") =>
  ({ templateId: "t", data: {}, phase, takenAt: 1, ...(outReason ? { outReason } : {}) }) as ChannelState["active"];

describe("rowsOnAir", () => {
  it("collects the rows a channel is showing", () => {
    const st = {
      channel: "program",
      active: graphic("in"),
      songSession: { rowId: "song" },
      scriptureSession: { rowId: "scr" },
      slidesSession: { rowId: "sl" },
      media: { rowId: "vid", playback: { status: "playing" } },
    } as unknown as ChannelState;
    expect([...rowsOnAir(st, src("gfx"))].sort()).toEqual(["gfx", "scr", "sl", "song", "vid"]);
  });

  it("leaves out a graphic animating out and a finished video", () => {
    const st = { channel: "program", active: graphic("out"), media: { rowId: "vid", playback: { status: "ended" } } } as unknown as ChannelState;
    expect([...rowsOnAir(st, src("gfx"))]).toEqual([]);
  });
});

describe("item end tracker", () => {
  function setup() {
    let state: ChannelState = { channel: "program", active: null };
    let source: RowSource | null = null;
    const ended: [string, string][] = [];
    const t = createItemEndTracker(
      () => state,
      () => source,
      (channel, rowId) => ended.push([channel, rowId]),
    );
    const set = (s: Partial<ChannelState>, from: RowSource | null = source) => {
      state = { channel: "program", active: null, ...s } as ChannelState;
      source = from;
      t.onChange("program");
    };
    return { set, ended };
  }

  it("reports a row the operator cleared", () => {
    const { set, ended } = setup();
    set({});
    set({ active: graphic("in") }, src("r1"));
    set({ active: graphic("out") }, null);
    expect(ended).toEqual([["program", "r1"]]);
  });

  it("does not report a graphic animating out on its own (auto-out)", () => {
    const { set, ended } = setup();
    set({});
    set({ active: graphic("in") }, src("r1"));
    set({ active: graphic("out", "auto") }, null);
    set({ active: null }, null);
    expect(ended).toEqual([]);
  });

  it("reports an ended song and a finished video", () => {
    const { set, ended } = setup();
    set({});
    set({ songSession: { rowId: "song" } as never });
    set({});
    set({ media: { rowId: "vid", playback: { status: "playing" } } as never });
    set({ media: { rowId: "vid", playback: { status: "ended" } } as never });
    expect(ended).toEqual([
      ["program", "song"],
      ["program", "vid"],
    ]);
  });

  it("reports the old row when another row replaces it", () => {
    const { set, ended } = setup();
    set({});
    set({ active: graphic("in") }, src("r1"));
    set({ active: graphic("in") }, src("r2"));
    expect(ended).toEqual([["program", "r1"]]);
  });

  it("reports a non-looping media deck that holds its last slide, not a lower third auto-outing over a loop", () => {
    const { set, ended } = setup();
    const deckOn = (atEnd: boolean) => ({
      slidesSession: { rowId: "deck", slot: "media", atEnd } as never,
      media: { rowId: "deck", owner: "mediaDeck:deck", playback: { status: "playing" } } as never,
    });
    set({});
    set(deckOn(false));
    set({ ...deckOn(false), active: graphic("in") }, src("lt"));
    set({ ...deckOn(false), active: graphic("out", "auto") }, null);
    expect(ended).toEqual([]);
    set(deckOn(true), null);
    expect(ended).toEqual([["program", "deck"]]);
  });

  it("reports a template deck that auto-advanced onto its end; a Space-armed end is still on air", () => {
    const { set, ended } = setup();
    const deck = (atEnd: boolean, autoEnded?: boolean) => ({
      active: graphic("in"),
      slidesSession: { rowId: "deck", slot: "graphics", atEnd, ...(autoEnded ? { autoEnded } : {}) } as never,
    });
    set({});
    set(deck(false), null);
    set(deck(true), null);
    expect(ended).toEqual([]);
    set(deck(false), null);
    set(deck(true, true), null);
    expect(ended).toEqual([["program", "deck"]]);
  });

  it("says nothing the first time it sees a channel", () => {
    const { set, ended } = setup();
    set({ active: graphic("out") }, null);
    expect(ended).toEqual([]);
  });
});
