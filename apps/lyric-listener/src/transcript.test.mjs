import { describe, expect, it } from "vitest";
import { cleanTranscript } from "./transcript.mjs";

describe("cleanTranscript", () => {
  it("drops whisper's silence hallucinations when they are the whole transcript", () => {
    expect(cleanTranscript(" you")).toBe("");
    expect(cleanTranscript("You.")).toBe("");
    expect(cleanTranscript("Thank you.")).toBe("");
    expect(cleanTranscript("Thanks for watching!")).toBe("");
  });

  it("keeps the same words inside a real line", () => {
    expect(cleanTranscript("I will praise you")).toBe("I will praise you");
    expect(cleanTranscript("thank you Lord")).toBe("thank you Lord");
  });

  it("strips non-speech annotations", () => {
    expect(cleanTranscript("[BLANK_AUDIO]")).toBe("");
    expect(cleanTranscript("(music)")).toBe("");
    expect(cleanTranscript("♪ amazing grace ♪")).toBe("amazing grace");
    expect(cleanTranscript("*applause* how sweet the sound")).toBe("how sweet the sound");
  });
});
