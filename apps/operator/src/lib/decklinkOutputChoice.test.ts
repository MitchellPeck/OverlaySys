import { describe, expect, it } from "vitest";
import type { ChannelWindowPrefs } from "@overlaysys/core";
import { applyOutputChoice, outputChoiceValue } from "./decklinkOutputChoice";

const base: ChannelWindowPrefs = { autoOpen: true, fullscreen: true, frameless: false, alwaysOnTop: false, transparent: false, displayId: 7 };

describe("output choice", () => {
  it("encodes displays, the primary and devices", () => {
    expect(outputChoiceValue(base)).toBe("display:7");
    expect(outputChoiceValue({ ...base, displayId: undefined })).toBe("display:");
    expect(outputChoiceValue({ ...base, decklink: { device: { name: "UltraStudio" }, format: "1080p59.94" } })).toBe("decklink:UltraStudio");
  });

  it("picking a device keeps the display settings and the format", () => {
    const a = applyOutputChoice(base, "decklink:UltraStudio");
    expect(a.decklink).toEqual({ device: { name: "UltraStudio" }, format: "1080p59.94" });
    expect(a.displayId).toBe(7);
    const b = applyOutputChoice({ ...a, decklink: { ...a.decklink!, format: "custom" } }, "decklink:Other");
    expect(b.decklink).toEqual({ device: { name: "Other" }, format: "custom" });
  });

  it("picking a display drops the device", () => {
    const a = applyOutputChoice({ ...base, decklink: { device: { name: "U" }, format: "1080p59.94" } }, "display:3");
    expect(a.decklink).toBeUndefined();
    expect(a.displayId).toBe(3);
    expect(applyOutputChoice(base, "display:").displayId).toBeUndefined();
  });

  it("a device name containing a colon survives the round trip", () => {
    expect(applyOutputChoice(base, "decklink:Card: A").decklink?.device.name).toBe("Card: A");
  });
});
