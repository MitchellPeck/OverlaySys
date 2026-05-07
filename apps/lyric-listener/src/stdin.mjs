#!/usr/bin/env node
// Minimal STT hypothesis source for OverlaySys.
//
// Reads recognized text from stdin and forwards each non-empty segment as
// an `stt_hypothesis` WS message. The server-side matcher does the rest.
//
// Handles two stdin formats:
//   1. One transcript per LF-terminated line (manual test, basic STT tools).
//   2. whisper-stream-style output that uses CR (\r) to overwrite the
//      current line in-place. We split on \r as well as \n, strip ANSI
//      escapes, and dedupe consecutive identical segments — so the matcher
//      only sees finalized transcripts, not partial overdraws.
//
// Real-world usage (whisper.cpp's stream example):
//   whisper-stream -m ~/whisper-models/ggml-base.en.bin --step 500 --length 5000 \
//     | node apps/lyric-listener/src/stdin.mjs
//
// Manual test:
//   echo "amazing grace how sweet the sound" | node apps/lyric-listener/src/stdin.mjs
//
// Environment:
//   WS_URL          Default ws://localhost:4000/ws
//   AUDIO_SOURCE_ID Default 'stdin-<hostname>'
//   LABEL           Default 'stdin'

import { WebSocket } from "ws";
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

// ANSI/CSI escape sequences (color, cursor moves, line erases).
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

let buffer = "";
let lastSent = "";

function emit(segment) {
  const cleaned = segment.replace(ANSI_RE, "").trim();
  if (!cleaned) return;
  if (cleaned === lastSent) return; // dedupe consecutive duplicates
  lastSent = cleaned;
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: "stt_hypothesis",
    audioSourceId: AUDIO_SOURCE_ID,
    text: cleaned,
    t: Date.now(),
  }));
}

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  // Split on any combination of CR and LF. Whisper-stream uses \r to
  // overwrite the current line as it refines the partial transcript;
  // a final segment is followed by \n. Treating both as separators
  // means each refinement becomes its own emit() call (deduped below).
  const parts = buffer.split(/[\r\n]+/);
  buffer = parts.pop() ?? "";
  for (const part of parts) emit(part);
});

process.stdin.on("end", () => {
  if (buffer) emit(buffer);
  ws.close();
});
