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

// Match the server's maxPayload (1 GB). The default in `ws` is 100 MB,
// which a single template/song save with embedded image data can exceed —
// every connected client (including this listener) receives those
// broadcasts, so a too-small client limit kills the listener with
// "max payload size exceeded". Listener never originates large messages
// itself; this only loosens the receive cap.
const ws = new WebSocket(URL, { maxPayload: 1024 * 1024 * 1024 });

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
  const msg = err?.message || err?.code || "unknown";
  console.error(`[lyric-listener] ws error: ${msg}`);
  if (err?.code === "ECONNREFUSED" || !err?.message) {
    console.error(`[lyric-listener] couldn't connect to ${URL} — is the OverlaySys server running? (try 'pnpm dev' in another terminal)`);
  }
  process.exit(1);
});

// ANSI/CSI escape sequences (color, cursor moves, line erases).
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

let buffer = "";
let lastSent = ""; // last (text + ":" + isFinal flag) we emitted

function emit(segment, isFinal) {
  const cleaned = segment.replace(ANSI_RE, "").trim();
  if (!cleaned) return;
  // Dedupe consecutive identical (text, isFinal) pairs, but allow the same
  // text through if the finality flag changes — the final is semantically
  // distinct from the partial that preceded it.
  const key = `${isFinal ? "F" : "P"}:${cleaned}`;
  if (key === lastSent) return;
  lastSent = key;
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: "stt_hypothesis",
    audioSourceId: AUDIO_SOURCE_ID,
    text: cleaned,
    t: Date.now(),
    isFinal,
  }));
}

// Split buffer into (text, terminator) segments. CR-only termination means
// the recognizer is overdrawing the line (partial); a terminator containing
// LF means the segment is finalized. Whisper-stream emits \r repeatedly
// within a step, then \n at the end.
const SEGMENT_RE = /([^\r\n]*)([\r\n]+)/g;

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  let lastIndex = 0;
  let m;
  SEGMENT_RE.lastIndex = 0;
  while ((m = SEGMENT_RE.exec(buffer)) !== null) {
    const text = m[1] ?? "";
    const term = m[2] ?? "";
    const isFinal = term.includes("\n");
    if (text) emit(text, isFinal);
    lastIndex = SEGMENT_RE.lastIndex;
  }
  buffer = buffer.slice(lastIndex);
});

process.stdin.on("end", () => {
  // Anything left in the buffer at EOF is implicitly final — no more
  // refinements coming.
  if (buffer) emit(buffer, true);
  ws.close();
});
