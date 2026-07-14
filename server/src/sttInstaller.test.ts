import { describe, expect, it } from "vitest";
import {
  enumerateCaptureDevices,
  enumerationInFlight,
  getModelsDir,
} from "./sttInstaller";

describe("sttInstaller", () => {
  it("getModelsDir honours OVERLAYSYS_MODELS_DIR override", () => {
    const prev = process.env["OVERLAYSYS_MODELS_DIR"];
    process.env["OVERLAYSYS_MODELS_DIR"] = "/tmp/overlaysys-models-test";
    try {
      expect(getModelsDir()).toBe("/tmp/overlaysys-models-test");
    } finally {
      if (prev === undefined) delete process.env["OVERLAYSYS_MODELS_DIR"];
      else process.env["OVERLAYSYS_MODELS_DIR"] = prev;
    }
  });

  it("getModelsDir falls back to ~/whisper-models when unset", () => {
    const prev = process.env["OVERLAYSYS_MODELS_DIR"];
    delete process.env["OVERLAYSYS_MODELS_DIR"];
    try {
      const dir = getModelsDir();
      expect(dir.endsWith("/whisper-models")).toBe(true);
    } finally {
      if (prev !== undefined) process.env["OVERLAYSYS_MODELS_DIR"] = prev;
    }
  });

  // The stderr-parsing regex is the most failure-prone piece of the
  // installer. Lock down the shape of what whisper-stream actually emits
  // so future whisper.cpp upgrades that tweak the format are caught here.
  it("parses whisper-stream capture-device lines", () => {
    const sample = `
load_backend: loaded CPU backend
init: found 3 capture devices:
init:    - Capture device #0: 'MacBook Pro Microphone'
init:    - Capture device #1: 'NDI Audio'
init:    - Capture device #2: 'iPhone Mic'
init: attempt to open default capture device ...
`;
    const re = /Capture device #(\d+):\s*'([^']*)'/g;
    const found: Array<{ id: number; name: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(sample)) !== null) {
      found.push({ id: Number(m[1]), name: m[2] ?? "" });
    }
    expect(found).toEqual([
      { id: 0, name: "MacBook Pro Microphone" },
      { id: 1, name: "NDI Audio" },
      { id: 2, name: "iPhone Mic" },
    ]);
  });

  it("device regex tolerates leading whitespace variants", () => {
    const sample = `init:- Capture device #5: 'X'\ninit:    - Capture device #6: 'Y'`;
    const re = /Capture device #(\d+):\s*'([^']*)'/g;
    const ids: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(sample)) !== null) {
      ids.push(Number(m[1]));
    }
    expect(ids).toEqual([5, 6]);
  });

  // With probe:false the enumerator must NEVER spawn whisper-stream (which
  // would contend for the mic against a live spawner). With no warm cache it
  // returns just the "System default" entry synchronously, and leaves no
  // in-flight probe behind.
  it("enumerateCaptureDevices({ probe: false }) never spawns a probe", async () => {
    const devices = await enumerateCaptureDevices({ force: true, probe: false });
    expect(devices).toEqual([{ id: -1, name: "System default" }]);
    // Crucially, no probe promise was created.
    expect(enumerationInFlight()).toBeNull();
  });
});
