#!/usr/bin/env node
// Channel-select STT capture (macOS). Records only the picked channels of a
// multichannel input with ffmpeg, averages them to mono, transcribes rolling
// windows with a local whisper-server, and writes transcripts to stdout in
// whisper-stream's format so the existing pipeline is unchanged:
//
//   node channels.mjs --ffmpeg <path> --model <ggml.bin> --device "<name>" \
//     --channels 17,18 [--max-channel 32] [--step 500] [--length 5000] \
//     | node stdin.mjs
//
// stderr carries logs plus two machine lines the server's spawner reads:
//   @@levels <peak> ...   per picked channel, ~10x/s (not logged)
//   @@error <message>     the reason for a fatal exit (shown as lastError)
// and `[start speaking]` once audio is flowing (the spawner's ready marker).
//
// Everything this spawns stays in our process group, so the spawner's group
// SIGTERM stops ffmpeg and whisper-server along with us.

import { spawn } from "node:child_process";
import net from "node:net";
import {
  ChannelMixer,
  KEEP_MS,
  SAMPLE_RATE,
  WindowScheduler,
  encodeWav,
  ffmpegCaptureArgs,
  formatTranscript,
  levelsLine,
  parseArgs,
  parseAvfoundationAudioDevices,
} from "./channelLib.mjs";

// Distinctive so the server's boot-time orphan reaper can find a
// whisper-server we left behind after a hard crash.
const INFERENCE_PATH = "/overlaysys-inference";
const READY_TIMEOUT_MS = 120_000;
const LEVELS_INTERVAL_MS = 100;
const MAX_CONSECUTIVE_FAILURES = 10;
const ERROR_LOG_INTERVAL_MS = 10_000;
const NO_AUDIO_TIMEOUT_MS = 5_000;

/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
let exiting = false;

function log(line) {
  process.stderr.write(`${line}\n`);
}

function fail(message) {
  log(`@@error ${message}`);
  shutdown(1);
}

function shutdown(code) {
  if (exiting) return;
  exiting = true;
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 100);
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
// The listener daemon exiting closes our stdout; nothing left to do.
process.stdout.on("error", () => shutdown(0));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function listAudioDevices(ffmpeg) {
  return new Promise((resolve) => {
    let text = "";
    const p = spawn(ffmpeg, ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    p.stderr.on("data", (d) => (text += d.toString()));
    p.on("error", () => resolve(null));
    p.on("close", () => resolve(parseAvfoundationAudioDevices(text)));
  });
}

/**
 * Forward a child's stderr as prefixed log lines, optionally filtered.
 * Returns a getter for the last line it printed (for error messages).
 */
function pipeLogs(child, prefix, keep = () => true) {
  let buf = "";
  let last = "";
  child.stderr.on("data", (d) => {
    buf += d.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      last = line.trim();
      if (keep(line)) log(`${prefix} ${line}`);
    }
  });
  return () => last;
}

async function waitForServer(port, child) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return;
  }
  const maxChannel = Number(process.argv[process.argv.indexOf("--max-channel") + 1] ?? 0);
  if (process.argv.includes("--max-channel") && maxChannel > 0) {
    const bad = args.channels.filter((c) => c > maxChannel);
    if (bad.length) {
      fail(`Channel ${bad.join(", ")} is out of range: '${args.device}' has ${maxChannel} input channel${maxChannel === 1 ? "" : "s"}`);
      return;
    }
  }

  log(`capturing '${args.device}' channels ${args.channels.join(", ")}`);
  const devices = await listAudioDevices(args.ffmpeg);
  if (devices === null) {
    fail(`Couldn't run ffmpeg at ${args.ffmpeg}`);
    return;
  }
  if (!devices.includes(args.device)) {
    fail(`Input device '${args.device}' not found`);
    return;
  }

  // ── whisper-server ──
  const port = await freePort();
  const whisper = spawn(
    args.whisperServer,
    ["-m", args.model, "--host", "127.0.0.1", "--port", String(port), "-nt", "--inference-path", INFERENCE_PATH],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  children.push(whisper);
  let whisperReady = false;
  // Until it's up, forward everything (model load, errors). After that,
  // whisper-server logs every request — keep only problems.
  // Nothing once we're shutting down: Metal teardown on SIGTERM prints a
  // harmless-but-alarming GGML_ASSERT.
  pipeLogs(
    whisper,
    "[whisper]",
    (line) => !exiting && (!whisperReady || /error|fail|abort/i.test(line)),
  );
  whisper.on("error", (err) => fail(`Couldn't start whisper-server: ${err.message}`));
  whisper.on("exit", (code, signal) => {
    if (!exiting) fail(`whisper-server stopped (${signal ?? `exit ${code}`})`);
  });
  if (!(await waitForServer(port, whisper))) {
    if (!exiting) fail("whisper-server didn't become ready");
    return;
  }
  whisperReady = true;
  log("[whisper] ready");

  // ── ffmpeg capture ──
  const mixer = new ChannelMixer(args.channels.length);
  const windows = new WindowScheduler({
    sampleRate: SAMPLE_RATE,
    stepMs: args.stepMs,
    lengthMs: args.lengthMs,
    keepMs: KEEP_MS,
  });
  const ffmpeg = spawn(args.ffmpeg, ffmpegCaptureArgs(args.device, args.channels), {
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(ffmpeg);
  const ffmpegLastLine = pipeLogs(ffmpeg, "[ffmpeg]");
  let gotAudio = false;
  let lastAudioAt = 0;
  ffmpeg.stdout.on("data", (chunk) => {
    lastAudioAt = Date.now();
    if (!gotAudio) {
      gotAudio = true;
      log("[start speaking]");
    }
    windows.append(mixer.push(chunk));
  });
  // An interface that drops off (USB unplugged, Dante restart) can leave
  // ffmpeg running but silent forever. Surface it as an error instead of a
  // green status that never transcribes.
  setInterval(() => {
    if (gotAudio && !exiting && Date.now() - lastAudioAt > NO_AUDIO_TIMEOUT_MS) {
      fail(`No audio from '${args.device}' for ${NO_AUDIO_TIMEOUT_MS / 1000} s. Check the interface is connected and on.`);
    }
  }, 1000);
  ffmpeg.on("error", (err) => fail(`Couldn't start ffmpeg: ${err.message}`));
  ffmpeg.on("exit", (code, signal) => {
    if (exiting) return;
    const detail = ffmpegLastLine();
    fail(
      gotAudio
        ? `ffmpeg stopped (${signal ?? `exit ${code}`})${detail ? `: ${detail}` : ""}`
        : detail
          ? `Couldn't capture '${args.device}': ${detail}`
          : `Couldn't open '${args.device}'. Check Microphone permission in System Settings.`,
    );
  });

  setInterval(() => {
    if (gotAudio) log(levelsLine(mixer.takePeaks()));
  }, LEVELS_INTERVAL_MS);

  // ── transcription loop ──
  let inFlight = false;
  let failures = 0;
  const lastErrorLog = new Map();
  setInterval(async () => {
    if (inFlight || exiting) return; // skip the step; audio keeps accumulating
    const w = windows.next();
    if (!w) return;
    inFlight = true;
    try {
      const form = new FormData();
      form.append("file", new Blob([encodeWav(w.samples, SAMPLE_RATE)], { type: "audio/wav" }), "audio.wav");
      form.append("response_format", "json");
      form.append("temperature", "0.0");
      const res = await fetch(`http://127.0.0.1:${port}${INFERENCE_PATH}`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(Math.max(10_000, args.lengthMs * 2)),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      failures = 0;
      const out = formatTranscript(String(body.text ?? ""), w.isFinal);
      if (out) process.stdout.write(out);
    } catch (err) {
      failures += 1;
      const kind = err instanceof Error ? err.name + ": " + err.message : String(err);
      const now = Date.now();
      if ((lastErrorLog.get(kind) ?? 0) + ERROR_LOG_INTERVAL_MS < now) {
        lastErrorLog.set(kind, now);
        log(`[whisper] request failed — ${kind}`);
      }
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        fail(`whisper-server failed ${failures} requests in a row (${kind})`);
      }
    } finally {
      inFlight = false;
    }
  }, Math.max(50, Math.floor(args.stepMs / 2)));
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
