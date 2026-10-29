import { describe, expect, it } from "vitest";
import * as core from "@overlaysys/core";
import type { DeckLinkErrorCode } from "@overlaysys/core";
import { DEFAULT_FORMAT_ID, SIGNAL_FORMATS, deckLinkErrorText, findFormat } from "./shared";

const CODES: DeckLinkErrorCode[] = [
  "ffmpeg-not-found", "no-decklink", "device-not-found", "device-ambiguous",
  "device-busy", "format-refused", "stalled", "exited",
];

describe("desktop copies of core's DeckLink values", () => {
  it("match core exactly (the main process can't import core at runtime)", () => {
    expect(SIGNAL_FORMATS).toEqual(core.SIGNAL_FORMATS);
    expect(DEFAULT_FORMAT_ID).toBe(core.DEFAULT_FORMAT_ID);
    expect(findFormat("nope")).toEqual(core.findFormat("nope"));
    for (const c of CODES) expect(deckLinkErrorText(c, "Dev")).toBe(core.deckLinkErrorText(c, "Dev"));
  });
});
