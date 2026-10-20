// Pure helpers for channels.mjs (channel-select STT capture). Kept free of
// I/O so they can be unit tested; channels.mjs wires them to ffmpeg,
// whisper-server and stdout.

export const SAMPLE_RATE = 16000;
export const MAX_CHANNELS = 4;
// whisper-stream's default "keep" — audio carried from the end of one window
// into the next so words straddling the boundary aren't lost.
export const KEEP_MS = 200;

/**
 * ffmpeg `pan` filter that keeps only the picked channels, as separate
 * outputs in pick order. Channels are 1-based (as the operator sees them);
 * ffmpeg's are 0-based.
 * @param {number[]} channels
 */
export function panFilter(channels) {
  const outs = channels.map((ch, i) => `c${i}=c${ch - 1}`);
  return `pan=${channels.length}c|${outs.join("|")}`;
}

/**
 * Arguments for capturing `device` (by macOS name) as raw 16 kHz s16le on
 * stdout, keeping only `channels`.
 * @param {string} device
 * @param {number[]} channels
 */
export function ffmpegCaptureArgs(device, channels) {
  return [
    "-hide_banner",
    // "info" so ffmpeg prints the input stream line (how many channels macOS
    // actually delivers); -nostats keeps it from logging progress forever.
    "-loglevel", "info",
    "-nostats",
    "-f", "avfoundation",
    "-i", `:${device}`,
    "-af", panFilter(channels),
    "-ar", String(SAMPLE_RATE),
    "-c:a", "pcm_s16le",
    "-f", "s16le",
    "pipe:1",
  ];
}

/**
 * Parse the runner's command line.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const raw = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith("--")) {
      raw[a.slice(2)] = argv[i + 1] ?? "";
      i++;
    }
  }
  const device = raw["device"] ?? "";
  if (!device) throw new Error("--device is required");
  const model = raw["model"] ?? "";
  if (!model) throw new Error("--model is required");
  const channels = (raw["channels"] ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => !Number.isNaN(n));
  if (
    channels.length === 0 ||
    channels.length > MAX_CHANNELS ||
    channels.some((n) => !Number.isInteger(n) || n < 1) ||
    new Set(channels).size !== channels.length
  ) {
    throw new Error(`--channels must list 1-${MAX_CHANNELS} unique channel numbers starting at 1`);
  }
  return {
    ffmpeg: raw["ffmpeg"] || "ffmpeg",
    whisperServer: raw["whisper-server"] || "whisper-server",
    model,
    device,
    channels,
    stepMs: Number(raw["step"] ?? 500) || 500,
    lengthMs: Number(raw["length"] ?? 5000) || 5000,
  };
}

/**
 * Turns interleaved s16le frames of K channels into mono float samples (the
 * average of the K channels) and tracks each channel's peak for the meter.
 */
export class ChannelMixer {
  /** @param {number} channelCount */
  constructor(channelCount) {
    this.k = channelCount;
    this.frameBytes = channelCount * 2;
    /** @type {Buffer} */
    this.carry = Buffer.alloc(0);
    this.peaks = new Array(channelCount).fill(0);
  }

  /**
   * @param {Buffer} chunk
   * @returns {Float32Array}
   */
  push(chunk) {
    const buf = this.carry.length ? Buffer.concat([this.carry, chunk]) : chunk;
    const frames = Math.floor(buf.length / this.frameBytes);
    const out = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      for (let c = 0; c < this.k; c++) {
        const v = buf.readInt16LE((f * this.k + c) * 2) / 32768;
        sum += v;
        const a = Math.abs(v);
        if (a > this.peaks[c]) this.peaks[c] = a;
      }
      out[f] = sum / this.k;
    }
    this.carry = Buffer.from(buf.subarray(frames * this.frameBytes));
    return out;
  }

  /** Peaks since the last call, then reset. */
  takePeaks() {
    const p = this.peaks.slice();
    this.peaks.fill(0);
    return p;
  }
}

/**
 * Rolling transcription windows, matching whisper-stream: every `stepMs` of
 * new audio, transcribe everything since the window began (a partial); once
 * the window reaches `lengthMs`, that transcription is final and the next
 * window starts with the last `keepMs` of audio.
 */
export class WindowScheduler {
  /**
   * @param {{ sampleRate: number; stepMs: number; lengthMs: number; keepMs: number; maxMs?: number }} o
   * `maxMs` caps any single window (whisper decodes at most 30 s).
   */
  constructor(o) {
    this.step = Math.round((o.sampleRate * o.stepMs) / 1000);
    this.length = Math.round((o.sampleRate * o.lengthMs) / 1000);
    this.keep = Math.round((o.sampleRate * o.keepMs) / 1000);
    this.max = Math.round((o.sampleRate * (o.maxMs ?? 28_000)) / 1000);
    /** @type {Float32Array[]} */
    this.parts = [];
    this.size = 0;
    this.fresh = 0;
  }

  /** @param {Float32Array} samples */
  append(samples) {
    if (samples.length === 0) return;
    this.parts.push(samples);
    this.size += samples.length;
    this.fresh += samples.length;
  }

  /** @returns {{ samples: Float32Array; isFinal: boolean } | null} */
  next() {
    if (this.fresh < this.step) return null;
    const all = this.flatten();
    const isFinal = all.length >= this.length;
    // A final covers EVERYTHING since the window began — when a slow request
    // made us skip steps the window runs past `length`, and trimming it would
    // drop words from the start that never get a final transcript.
    const samples = all.length > this.max ? all.subarray(all.length - this.max) : all;
    this.fresh = 0;
    if (isFinal) {
      const kept = all.slice(all.length - this.keep);
      this.parts = [kept];
      this.size = kept.length;
    }
    return { samples: Float32Array.from(samples), isFinal };
  }

  flatten() {
    if (this.parts.length === 1) return this.parts[0];
    const all = new Float32Array(this.size);
    let o = 0;
    for (const p of this.parts) {
      all.set(p, o);
      o += p.length;
    }
    this.parts = [all];
    return all;
  }
}

/**
 * 16-bit mono PCM WAV for whisper-server's /inference endpoint.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 */
export function encodeWav(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

/**
 * One transcript in whisper-stream's stdout convention, which the
 * lyric-listener daemon already parses: CR ends a partial, LF a final.
 * @param {string} text
 * @param {boolean} isFinal
 */
export function formatTranscript(text, isFinal) {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t + (isFinal ? "\n" : "\r");
}

/** @param {number[]} peaks */
export function levelsLine(peaks) {
  return `@@levels ${peaks.map((p) => p.toFixed(2)).join(" ")}`;
}

/**
 * Audio device names from `ffmpeg -f avfoundation -list_devices true -i ""`.
 * @param {string} text
 */
export function parseAvfoundationAudioDevices(text) {
  const names = [];
  let inAudio = false;
  for (const line of text.split(/\r?\n/)) {
    if (/AVFoundation audio devices:/.test(line)) {
      inAudio = true;
      continue;
    }
    if (/AVFoundation video devices:/.test(line)) {
      inAudio = false;
      continue;
    }
    if (!inAudio) continue;
    const m = line.match(/\]\s\[(\d+)\]\s(.+)$/);
    if (m) names.push(m[2].trim());
  }
  return names;
}

// Channel counts for ffmpeg's named layouts.
const LAYOUT_CHANNELS = {
  mono: 1, stereo: 2, "2.1": 3, "3.0": 3, quad: 4, "4.0": 4, "4.1": 5,
  "5.0": 5, "5.1": 6, "6.0": 6, "6.1": 7, "7.0": 7, "7.1": 8, octagonal: 8,
};

/**
 * Sample rate and channel count from ffmpeg's input stream line, e.g.
 * "Stream #0:0: Audio: pcm_f32le, 48000 Hz, 32 channels, flt". This is what
 * macOS actually hands ffmpeg — which can be fewer channels than the device
 * has. Null for any other line.
 * @param {string} line
 */
export function parseInputStream(line) {
  const m = line.match(/Stream #0:0[^:]*: Audio: [^,]+, (\d+) Hz, ([^,]+)/);
  if (!m) return null;
  const layout = m[2].trim();
  const n = layout.match(/^(\d+) channels/);
  const channels = n ? Number(n[1]) : LAYOUT_CHANNELS[layout.replace(/\(.*\)$/, "")];
  if (!channels) return null;
  return { sampleRate: Number(m[1]), channels };
}
