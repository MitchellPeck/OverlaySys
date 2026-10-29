import { describe, expect, it } from "vitest";
import { assetRewrites, devProxyEnabled } from "./devProxy.mjs";

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
  it("never proxies in production or cloud builds", () => {
    expect(assetRewrites({ NODE_ENV: "production" })).toEqual([]);
    expect(assetRewrites({ NEXT_PUBLIC_OVERLAYSYS_CLOUD_MODE: "1" })).toEqual([]);
    expect(devProxyEnabled({ NODE_ENV: "development" })).toBe(true);
  });
});
