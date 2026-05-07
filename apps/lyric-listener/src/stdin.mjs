#!/usr/bin/env node
// Minimal STT hypothesis source for OverlaySys.
//
// Reads one line of recognized text per stdin line and forwards each as an
// `stt_hypothesis` WS message. The server-side matcher does the rest.
//
// Real-world usage:
//   whisper-cli --model models/ggml-base.en.bin --no-timestamps --stream \
//     | node apps/lyric-listener/src/stdin.mjs
//
// Manual test:
//   echo "amazing grace how sweet the sound" | node apps/lyric-listener/src/stdin.mjs
//
// Environment:
//   WS_URL          Default ws://localhost:4000/ws
//   AUDIO_SOURCE_ID Default 'stdin'
//   LABEL           Default 'stdin'

import { WebSocket } from "ws";
import { createInterface } from "node:readline";
import os from "node:os";

const URL = process.env.WS_URL ?? "ws://localhost:4000/ws";
const AUDIO_SOURCE_ID = process.env.AUDIO_SOURCE_ID ?? `stdin-${os.hostname()}`;
const LABEL = process.env.LABEL ?? "stdin";

const ws = new WebSocket(URL);

ws.on("open", () => {
  ws.send(JSON.stringify({
    type: "stt_listener_register",
    audioSourceId: AUDIO_SOURCE_ID,
    label: LABEL,
  }));
  console.error(`[lyric-listener] connected; registered as ${AUDIO_SOURCE_ID}`);
});

ws.on("message", (raw) => {
  try {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "stt_match") {
      const s = msg.suggestedSlide;
      const where = s ? `section ${s.sectionIdx + 1}, slide ${s.slideIdx + 1}` : "(no match)";
      const pct = (msg.confidence * 100).toFixed(0);
      console.error(`[stt_match] ${pct}% → ${where}  | "${msg.hypothesis}"`);
    }
  } catch {
    // Ignore non-JSON or parse errors.
  }
});

ws.on("close", () => {
  console.error("[lyric-listener] disconnected");
  process.exit(0);
});

ws.on("error", (err) => {
  console.error("[lyric-listener] ws error:", err.message);
  process.exit(1);
});

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: "stt_hypothesis",
    audioSourceId: AUDIO_SOURCE_ID,
    text,
    t: Date.now(),
  }));
});
rl.on("close", () => {
  ws.close();
});
