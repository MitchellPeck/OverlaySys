import { describe, expect, it } from "vitest";
import { assetRewrites } from "./devProxy";

describe("assetRewrites", () => {
  it("proxies /assets to the local server by default", () => {
    expect(assetRewrites({})).toEqual([
      { source: "/assets/:p*", destination: "http://localhost:4000/assets/:p*" },
    ]);
  });
  it("honours OVERLAYSYS_SERVER_URL and trims a trailing slash", () => {
    expect(assetRewrites({ OVERLAYSYS_SERVER_URL: "http://10.0.0.5:4000/" })).toEqual([
      { source: "/assets/:p*", destination: "http://10.0.0.5:4000/assets/:p*" },
    ]);
  });
  it("never proxies in static builds", () => {
    expect(assetRewrites({ NEXT_BUILD_STATIC: "1" })).toEqual([]);
  });
});
