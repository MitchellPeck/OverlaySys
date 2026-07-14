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
// The WS connection is resilient: a dropped/refused socket schedules a
// reconnect with backoff rather than killing the process, so a transient
// server hiccup no longer tears the whole STT pipeline down (which would
// SIGPIPE whisper-stream and require a manual restart). The daemon only exits
// when stdin closes — i.e. whisper-stream itself has ended.
//
// This daemon is write-only over the socket: it PRODUCES hypotheses and
// consumes nothing. The server unsubscribes it from broadcasts the moment it
// registers, so in steady state it receives nothing. The generous maxPayload
// below only covers the tiny window between socket-open and that unsubscribe,
// where a large template/song broadcast could still land and otherwise blow
// the default 100 MB `ws` cap (killing the socket and forcing a reconnect).
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

// Reconnect backoff bounds.
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;

let ws = null;
let reconnectDelay = RECONNECT_MIN_MS;
let reconnectTimer = null;
let shuttingDown = false;

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (shuttingDown) return;
  const sock = new WebSocket(URL, { maxPayload: 1024 * 1024 * 1024 });
  ws = sock;

  sock.on("open", () => {
    reconnectDelay = RECONNECT_MIN_MS; // reset backoff on a good connection
    sock.send(
      JSON.stringify({
        type: "stt_listener_register",
        audioSourceId: AUDIO_SOURCE_ID,
        label: LABEL,
      }),
    );
    console.error(`[lyric-listener] connected; registered as ${AUDIO_SOURCE_ID}`);
  });

  sock.on("close", () => {
    if (ws === sock) ws = null;
    if (shuttingDown) {
      process.exit(0);
      return;
    }
    console.error("[lyric-listener] disconnected — reconnecting…");
    scheduleReconnect();
  });

  sock.on("error", (err) => {
    const msg = err?.message || err?.code || "unknown";
    if (err?.code === "ECONNREFUSED" || !err?.message) {
      console.error(
        `[lyric-listener] couldn't connect to ${URL} — is the OverlaySys server running? (try 'pnpm dev' in another terminal)`,
      );
    } else {
      console.error(`[lyric-listener] ws error: ${msg}`);
    }
    // Don't exit — the 'close' that follows an error schedules the retry.
    // Some error conditions don't emit 'close', so nudge a reconnect here too.
    try {
      sock.terminate();
    } catch {
      // already closing
    }
    if (ws === sock) ws = null;
    if (!shuttingDown) scheduleReconnect();
  });
}

connect();

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
  // Drop the hypothesis if we're not connected — transcripts are realtime,
  // a stale one delivered seconds later after a reconnect is worse than none.
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(
    JSON.stringify({
      type: "stt_hypothesis",
      audioSourceId: AUDIO_SOURCE_ID,
      text: cleaned,
      t: Date.now(),
      isFinal,
    }),
  );
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
  // refinements coming. whisper-stream has ended, so the daemon is done.
  if (buffer) emit(buffer, true);
  shuttingDown = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
    // Give the close frame a moment, then exit regardless.
    setTimeout(() => process.exit(0), 200);
  } else {
    process.exit(0);
  }
});
