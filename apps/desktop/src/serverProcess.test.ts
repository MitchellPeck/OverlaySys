import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  clearPidFile,
  isProcessAlive,
  readPidFile,
  writePidFile,
} from "./serverProcess";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "overlaysys-srvpid-"));
  file = path.join(dir, "server.pid");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readPidFile", () => {
  it("returns null when the file is missing", () => {
    expect(readPidFile(file)).toBeNull();
  });
  it("parses a plain integer pid", () => {
    writeFileSync(file, "12345\n");
    expect(readPidFile(file)).toBe(12345);
  });
  it("returns null for garbage or non-positive contents", () => {
    writeFileSync(file, "not-a-pid");
    expect(readPidFile(file)).toBeNull();
    writeFileSync(file, "0");
    expect(readPidFile(file)).toBeNull();
    writeFileSync(file, "-4");
    expect(readPidFile(file)).toBeNull();
  });
});

describe("writePidFile / clearPidFile", () => {
  it("round-trips a pid", () => {
    writePidFile(file, 4242);
    expect(readPidFile(file)).toBe(4242);
  });
  it("clearPidFile removes the file and is a no-op when absent", () => {
    writePidFile(file, 7);
    clearPidFile(file);
    expect(existsSync(file)).toBe(false);
    expect(() => clearPidFile(file)).not.toThrow();
  });
});

describe("isProcessAlive", () => {
  it("reports the current process as alive", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });
  it("reports an unused pid as dead", () => {
    // PID 2^31-1 is effectively never allocated.
    expect(isProcessAlive(2147483646)).toBe(false);
  });
  it("treats a non-positive pid as dead (never kill pid 0 / a group)", () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
  });
});
