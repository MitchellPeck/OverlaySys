import { describe, expect, it } from "vitest";
import { prefixServerPath } from "./localServerUrl";

describe("prefixServerPath", () => {
  it("prefixes assets and live-folder files", () => {
    expect(prefixServerPath("/assets/a.png", "http://h:4000")).toBe("http://h:4000/assets/a.png");
    expect(prefixServerPath("/media-folders/f/a%20b.png", "http://h:4000")).toBe("http://h:4000/media-folders/f/a%20b.png");
  });
  it("leaves absolute and other URLs alone", () => {
    expect(prefixServerPath("https://x/y.png", "http://h:4000")).toBe("https://x/y.png");
    expect(prefixServerPath("/other/a.png", "http://h:4000")).toBe("/other/a.png");
  });
});
