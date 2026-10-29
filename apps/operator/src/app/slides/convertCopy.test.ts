import { describe, expect, it } from "vitest";
import { convertResultMessage, convertWarningsMessage, derivedLicensing, titleSlideBlocker } from "./convertCopy";

describe("convertResultMessage", () => {
  it("names the deck and counts rows and shows", () => {
    expect(convertResultMessage({ deckName: "Song A", rows: 3, shows: 2 })).toBe(
      'Converted to deck "Song A" · switched 3 rows in 2 shows',
    );
  });
  it("uses singular forms", () => {
    expect(convertResultMessage({ deckName: "Song A", rows: 1, shows: 1 })).toBe(
      'Converted to deck "Song A" · switched 1 row in 1 show',
    );
  });
  it("drops the switched part when no row changed", () => {
    expect(convertResultMessage({ deckName: "Song A", rows: 0, shows: 0 })).toBe('Converted to deck "Song A"');
  });
});

describe("convertWarningsMessage", () => {
  it("lists every warning in one message", () => {
    expect(convertWarningsMessage(["Warning A", "Warning B"])).toBe("Warning A · Warning B");
  });
  it("is null with no warnings", () => {
    expect(convertWarningsMessage([])).toBeNull();
  });
});

describe("derivedLicensing", () => {
  it("is CCLI with the number when the song has one", () => {
    expect(derivedLicensing({ ccliNumber: "123" })).toEqual({ kind: "ccli", ccliNumber: "123" });
  });
  it("is public domain otherwise", () => {
    expect(derivedLicensing({})).toEqual({ kind: "public-domain" });
  });
});

describe("titleSlideBlocker", () => {
  it("explains a missing intro design", () => {
    expect(titleSlideBlocker({})).toBe("This song has no intro design");
    expect(titleSlideBlocker({ defaultIntroTemplateId: "t1" })).toBeNull();
  });
});
