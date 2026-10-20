// Channel-select STT smoke test: runs the real capture script (ffmpeg +
// whisper-server) against a device you name and prints what it hears.
//
//   node server/scripts/stt-channels-smoke.mjs "<device name>" 17,18 [seconds] [model]
//
// Needs whisper-server (brew install whisper-cpp) and a ggml model
// (default ~/whisper-models/ggml-base.en.bin). Run from the repo root.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const [device, channels = "1", seconds = "10", model = path.join(os.homedir(), "whisper-models", "ggml-base.en.bin")] =
  process.argv.slice(2);
if (!device) {
  console.error('usage: node server/scripts/stt-channels-smoke.mjs "<device name>" 17,18 [seconds] [model]');
  process.exit(2);
}

const require = createRequire(path.resolve("server/package.json"));
const ffmpeg = require("ffmpeg-static");
const child = spawn(
  process.execPath,
  [
    "apps/lyric-listener/src/channels.mjs",
    "--ffmpeg", ffmpeg,
    "--model", model,
    "--device", device,
    "--channels", channels,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let lastLevels = "";
child.stderr.on("data", (d) => {
  for (const line of d.toString().split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("@@levels")) lastLevels = line.slice(9);
    else if (!/^\[whisper\] (whisper_|ggml_|load_backend|system_info|main:)/.test(line)) console.error(line);
  }
});
child.stdout.on("data", (d) => {
  for (const seg of d.toString().split(/(?<=[\r\n])/)) {
    const final = seg.endsWith("\n");
    const text = seg.trim();
    if (text) console.log(`${final ? "FINAL  " : "partial"} ${text}   (levels ${lastLevels})`);
  }
});
child.on("exit", (code) => {
  console.error(`capture exited (${code})`);
  process.exit(code ?? 0);
});
setTimeout(() => child.kill("SIGTERM"), Number(seconds) * 1000);
