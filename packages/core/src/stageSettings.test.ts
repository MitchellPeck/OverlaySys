import { describe, expect, it } from "vitest";
import { DEFAULT_MESSAGE_PRESETS, StageSettingsSchema } from "./stageSettings";

describe("StageSettingsSchema", () => {
  it("defaults the presets", () => {
    expect(StageSettingsSchema.parse({}).messagePresets).toEqual(DEFAULT_MESSAGE_PRESETS);
    expect(DEFAULT_MESSAGE_PRESETS).toEqual(["Wrap up", "5 minutes", "Stand by"]);
  });
  it("trims and drops blank presets", () => {
    expect(StageSettingsSchema.parse({ messagePresets: [" Go ", "", "  "] }).messagePresets).toEqual(["Go"]);
  });
});
