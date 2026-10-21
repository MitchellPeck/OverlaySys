import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _resetFumsForTest, _setFumsFetchForTest, fumsUrl, reportViews } from "./fums";

let tmp: string;
let prev: string | undefined;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-fums-"));
  prev = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmp;
  _resetFumsForTest();
});
afterEach(async () => {
  _setFumsFetchForTest(null);
  if (prev === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prev;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("fums", () => {
  it("builds the f3 URL with repeated t params", () => {
    expect(fumsUrl(["a", "b"], "dev", "ses")).toBe("https://fums.api.bible/f3?t=a&t=b&dId=dev&sId=ses");
  });

  it("reports with a device id that persists across calls and restarts", async () => {
    const urls: string[] = [];
    _setFumsFetchForTest(async (u) => { urls.push(u); return {}; });
    await reportViews(["a"]);
    _resetFumsForTest(); // simulate restart: cache cleared, file remains
    await reportViews(["b"]);
    const dId = (u: string) => new URL(u).searchParams.get("dId");
    expect(urls).toHaveLength(2);
    expect(dId(urls[0]!)).toBeTruthy();
    expect(dId(urls[0]!)).toBe(dId(urls[1]!));
    const saved = JSON.parse(await fs.readFile(path.join(tmp, "settings", "api-bible-device.json"), "utf8"));
    expect(saved.deviceId).toBe(dId(urls[0]!));
  });

  it("does nothing for no tokens and swallows network errors", async () => {
    let calls = 0;
    _setFumsFetchForTest(async () => { calls++; throw new TypeError("fetch failed"); });
    await reportViews([]);
    expect(calls).toBe(0);
    await expect(reportViews(["a"])).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });
});
