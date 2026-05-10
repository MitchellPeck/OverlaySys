import { describe, expect, it } from "vitest";
import { lyricTokens, phoneticFold, tokenize, isStopWord } from "./lyricTokens";

describe("phoneticFold", () => {
  it("collapses dropped-g endings", () => {
    expect(phoneticFold("amazing")).toBe("amazin");
    expect(phoneticFold("amazin")).toBe("amazin");
    expect(phoneticFold("singing")).toBe("singin");
  });

  it("does not strip 'ing' from short words where it's part of the root", () => {
    // "king", "ring", "sing" should NOT be folded — they're 3-4 chars and
    // dropping 'g' produces unrelated keys.
    expect(phoneticFold("king")).toBe("king");
    expect(phoneticFold("ring")).toBe("ring");
    expect(phoneticFold("sing")).toBe("sing");
  });

  it("strips contraction and possessive tails", () => {
    expect(phoneticFold("i've")).toBe("i");
    expect(phoneticFold("lord's")).toBe("lord");
    expect(phoneticFold("we're")).toBe("we");
    expect(phoneticFold("don't")).toBe("dont");
    expect(phoneticFold("they'll")).toBe("they");
    expect(phoneticFold("amazin'")).toBe("amazin");
  });

  it("maps archaic pronouns to modern", () => {
    expect(phoneticFold("thee")).toBe("you");
    expect(phoneticFold("thou")).toBe("you");
    expect(phoneticFold("thy")).toBe("your");
    expect(phoneticFold("thine")).toBe("yours");
    expect(phoneticFold("art")).toBe("are");
  });

  it("is idempotent", () => {
    for (const w of ["amazin", "you", "your", "lord", "grace", "free"]) {
      expect(phoneticFold(phoneticFold(w))).toBe(phoneticFold(w));
    }
  });
});

describe("tokenize", () => {
  it("lowercases, strips punctuation, splits on whitespace", () => {
    expect(tokenize("Amazing GRACE!")).toEqual(["amazing", "grace"]);
    expect(tokenize("How sweet, the sound.")).toEqual([
      "how",
      "sweet",
      "the",
      "sound",
    ]);
  });

  it("preserves apostrophes inside words", () => {
    expect(tokenize("I've been")).toEqual(["i've", "been"]);
  });

  it("returns [] for empty/whitespace input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   \n\t  ")).toEqual([]);
  });
});

describe("lyricTokens", () => {
  it("filters stop words after folding", () => {
    expect(lyricTokens("Amazing grace how sweet the sound")).toEqual([
      "amazin",
      "grace",
      "how",
      "sweet",
      "sound",
    ]);
  });

  it("drops auxiliaries like 'are' / 'is' / 'was'", () => {
    expect(lyricTokens("My chains are gone")).toEqual(["my", "chains", "gone"]);
  });

  it("survives heavy contraction text", () => {
    // "I've been set free" → folded ["i", "been", "set", "free"] → drop
    // stop word "been" → ["i", "set", "free"]. "i" stays because it's
    // not in the stop list (pronouns carry lyric content).
    expect(lyricTokens("I've been set free")).toEqual(["i", "set", "free"]);
  });

  it("collapses 'thou art' and 'you are' to the same token sequence", () => {
    // After fold + stop-word filter, both should produce ["you"] since
    // "are" is a stop word.
    expect(lyricTokens("Thou art")).toEqual(["you"]);
    expect(lyricTokens("you are")).toEqual(["you"]);
  });
});

describe("isStopWord", () => {
  it("flags common articles and auxiliaries", () => {
    for (const w of ["a", "an", "the", "is", "are", "of", "to", "in"]) {
      expect(isStopWord(w)).toBe(true);
    }
  });

  it("does not flag content words", () => {
    for (const w of ["grace", "amazin", "you", "love", "lord"]) {
      expect(isStopWord(w)).toBe(false);
    }
  });
});
