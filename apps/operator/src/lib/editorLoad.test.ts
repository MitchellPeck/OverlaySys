import { describe, expect, it } from "vitest";
import { isNotFoundFor, loadFailedText } from "./editorLoad";

describe("isNotFoundFor", () => {
  it("matches the server's not_found reply for that id", () => {
    expect(isNotFoundFor({ type: "error", code: "not_found", message: "s1" }, "s1")).toBe(true);
  });
  it("ignores other ids, codes and message types", () => {
    expect(isNotFoundFor({ type: "error", code: "not_found", message: "s2" }, "s1")).toBe(false);
    expect(isNotFoundFor({ type: "error", code: "invalid", message: "s1" }, "s1")).toBe(false);
    expect(isNotFoundFor({ type: "show", message: "s1" }, "s1")).toBe(false);
  });
});

describe("loadFailedText", () => {
  it("names what failed and why", () => {
    expect(loadFailedText("show", new Error("offline"))).toBe("Couldn't load the show: offline");
    expect(loadFailedText("hotcard", "boom")).toBe("Couldn't load the hotcard: boom");
  });
});
