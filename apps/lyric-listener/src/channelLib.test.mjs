import { describe, expect, it } from "vitest";
import {
  ChannelMixer,
  WindowScheduler,
  encodeWav,
  ffmpegCaptureArgs,
  formatTranscript,
  levelsLine,
  panFilter,
  parseArgs,
  parseAvfoundationAudioDevices,
} from "./channelLib.mjs";

describe("panFilter", () => {
  it("keeps the picked 1-based channels as separate 0-based outputs", () => {
    expect(panFilter([17, 18])).toBe("pan=2c|c0=c16|c1=c17");
    expect(panFilter([1])).toBe("pan=1c|c0=c0");
  });
});

describe("ffmpegCaptureArgs", () => {
  it("captures the device by name at 16 kHz raw s16le on stdout", () => {
    const args = ffmpegCaptureArgs("Dante Virtual Soundcard", [3, 4]);
    expect(args).toContain(":Dante Virtual Soundcard");
    expect(args[args.indexOf("-af") + 1]).toBe("pan=2c|c0=c2|c1=c3");
    expect(args.slice(-2)).toEqual(["s16le", "pipe:1"]);
    expect(args[args.indexOf("-ar") + 1]).toBe("16000");
  });
});

describe("parseArgs", () => {
  it("parses the runner's flags", () => {
    const a = parseArgs([
      "--ffmpeg", "/x/ffmpeg", "--model", "/m.bin", "--device", "Dante",
      "--channels", "17,18", "--step", "500", "--length", "5000",
    ]);
    expect(a).toMatchObject({
      ffmpeg: "/x/ffmpeg",
      whisperServer: "whisper-server",
      model: "/m.bin",
      device: "Dante",
      channels: [17, 18],
      stepMs: 500,
      lengthMs: 5000,
    });
  });

  it("rejects a missing device or bad channel list", () => {
    expect(() => parseArgs(["--model", "/m", "--channels", "1"])).toThrow(/device/);
    expect(() => parseArgs(["--model", "/m", "--device", "D", "--channels", "0"])).toThrow(/channel/);
    expect(() => parseArgs(["--model", "/m", "--device", "D", "--channels", "1,2,3,4,5"])).toThrow(/channel/);
  });
});

function interleave(frames) {
  // frames: number[][] of int16 sample values, one inner array per frame
  const k = frames[0].length;
  const buf = Buffer.alloc(frames.length * k * 2);
  frames.forEach((f, i) => f.forEach((v, c) => buf.writeInt16LE(v, (i * k + c) * 2)));
  return buf;
}

describe("ChannelMixer", () => {
  it("averages channels to mono and tracks per-channel peaks", () => {
    const m = new ChannelMixer(2);
    const out = m.push(interleave([[16384, 0], [-32768, 16384]]));
    expect(Array.from(out)).toEqual([0.25, -0.25]);
    expect(m.takePeaks()).toEqual([1, 0.5]);
    expect(m.takePeaks()).toEqual([0, 0]); // reset after read
  });

  it("carries a split frame across chunks", () => {
    const m = new ChannelMixer(2);
    const whole = interleave([[16384, 16384], [8192, 8192]]);
    const a = m.push(whole.subarray(0, 3));
    const b = m.push(whole.subarray(3));
    expect(a.length + b.length).toBe(2);
    expect(Array.from(b).at(-1)).toBe(0.25);
  });
});

describe("WindowScheduler", () => {
  // 1 kHz keeps the numbers small: step 100 ms = 100 samples.
  const mk = () => new WindowScheduler({ sampleRate: 1000, stepMs: 100, lengthMs: 300, keepMs: 50 });
  const feed = (s, n) => s.append(new Float32Array(n).fill(0.1));

  it("waits for a full step of new audio", () => {
    const s = mk();
    feed(s, 50);
    expect(s.next()).toBeNull();
  });

  it("emits growing partials, then a final at the window length, keeping the overlap", () => {
    const s = mk();
    feed(s, 100);
    expect(s.next()).toMatchObject({ isFinal: false });
    expect(s.next()).toBeNull();
    feed(s, 100);
    const p2 = s.next();
    expect(p2.isFinal).toBe(false);
    expect(p2.samples.length).toBe(200);
    feed(s, 100);
    const f = s.next();
    expect(f.isFinal).toBe(true);
    expect(f.samples.length).toBe(300);
    feed(s, 100);
    const next = s.next();
    expect(next.isFinal).toBe(false);
    expect(next.samples.length).toBe(150); // 50 kept + 100 new
  });

  it("a skipped step (request in flight) just yields a bigger window later", () => {
    const s = mk();
    feed(s, 100);
    feed(s, 100); // no next() in between
    expect(s.next().samples.length).toBe(200);
  });

  it("never sends more than the window length", () => {
    const s = mk();
    feed(s, 1000);
    const w = s.next();
    expect(w.isFinal).toBe(true);
    expect(w.samples.length).toBe(300);
  });
});

describe("encodeWav", () => {
  it("writes a 16-bit mono PCM WAV", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]), 16000);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt16LE(22)).toBe(1); // channels
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(6);
    expect(wav.readInt16LE(46)).toBe(32767);
    expect(wav.readInt16LE(48)).toBe(-32768);
  });
});

describe("formatTranscript / levelsLine", () => {
  it("uses whisper-stream's CR-partial / LF-final convention on one line", () => {
    expect(formatTranscript(" Amazing grace\n how sweet ", false)).toBe("Amazing grace how sweet\r");
    expect(formatTranscript("the sound", true)).toBe("the sound\n");
    expect(formatTranscript("   ", true)).toBe("");
  });

  it("formats levels with two decimals", () => {
    expect(levelsLine([0.123, 1])).toBe("@@levels 0.12 1.00");
  });
});

describe("parseAvfoundationAudioDevices", () => {
  it("reads only the audio device names from ffmpeg's listing", () => {
    const text = [
      "[AVFoundation indev @ 0x1] AVFoundation video devices:",
      "[AVFoundation indev @ 0x1] [0] FaceTime HD Camera",
      "[AVFoundation indev @ 0x1] AVFoundation audio devices:",
      "[AVFoundation indev @ 0x1] [0] MacBook Pro Microphone",
      "[AVFoundation indev @ 0x1] [1] Dante Virtual Soundcard",
      ": Input/output error",
    ].join("\n");
    expect(parseAvfoundationAudioDevices(text)).toEqual([
      "MacBook Pro Microphone",
      "Dante Virtual Soundcard",
    ]);
  });
});
