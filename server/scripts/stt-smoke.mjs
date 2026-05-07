// Plan B smoke: end-to-end STT match + trust-mode auto-advance over WS.
//
// Self-contained — creates its own test song and show via WS so it doesn't
// depend on user-edited fixtures. Saves and deletes them on each run.
//
// Drives the full server pipeline:
//   1. Save a test song + a one-row show that references it
//   2. Subscribe to program; song_take the row
//   3. Register as a listener
//   4. Send a hypothesis → expect stt_match (suggestion only, trust off)
//   5. Verify cursor did NOT auto-advance
//   6. Enable trust mode via song_set_trust
//   7. Send a forward-matching hypothesis → expect cursor auto-advance after debounce

import { WebSocket } from "ws";

const url = process.env.WS_URL ?? "ws://localhost:4000/ws";
const ws = new WebSocket(url);

const SONG_ID = "stt-smoke-song";
const SHOW_ID = "stt-smoke-show";
const ROW_ID = "stt-smoke-row";

const TEST_SONG = {
  id: SONG_ID,
  title: "STT Smoke Song",
  sections: [
    {
      id: "a",
      kind: "verse",
      label: "Verse",
      slides: [
        { id: "a1", lines: ["alpha bravo charlie delta"] },
        { id: "a2", lines: ["echo foxtrot golf hotel"] },
      ],
    },
    {
      id: "b",
      kind: "chorus",
      label: "Chorus",
      slides: [{ id: "b1", lines: ["india juliet kilo lima mike"] }],
    },
  ],
  defaultArrangement: ["a", "b"],
};

const TEST_SHOW = {
  id: SHOW_ID,
  name: "STT Smoke Show",
  rows: [
    {
      kind: "song",
      id: ROW_ID,
      songId: SONG_ID,
      lyricTemplateId: "lyric-default",
    },
  ],
};

const received = [];
let resolveDone;
const done = new Promise((r) => (resolveDone = r));
const timeout = setTimeout(() => {
  console.error("FAIL: stt-smoke timed out");
  console.error("received:", received.map((m) => m.type));
  process.exit(1);
}, 12000);

function s(msg) { ws.send(JSON.stringify(msg)); }

ws.on("open", () => {
  s({ type: "subscribe", channel: "program", role: "operator" });

  s({ type: "save_song", song: TEST_SONG });
  s({ type: "save_show", show: TEST_SHOW });

  setTimeout(() => s({
    type: "song_take",
    channel: "program",
    showId: SHOW_ID,
    songRowId: ROW_ID,
  }), 150);

  setTimeout(() => s({
    type: "stt_listener_register",
    audioSourceId: "stt-smoke",
    label: "smoke",
  }), 250);

  // Suggestion-only path (trust mode off): hypothesis matches a2.
  setTimeout(() => s({
    type: "stt_hypothesis",
    audioSourceId: "stt-smoke",
    text: "echo foxtrot golf hotel",
    t: Date.now(),
  }), 400);

  // Enable trust mode.
  setTimeout(() => s({
    type: "song_set_trust",
    channel: "program",
    trustMode: true,
  }), 800);

  // Hypothesis matching b1 (the chorus) — forward jump.
  setTimeout(() => s({
    type: "stt_hypothesis",
    audioSourceId: "stt-smoke",
    text: "india juliet kilo lima mike",
    t: Date.now(),
  }), 1000);

  // Wait for the 300ms auto-advance debounce + safety margin.
  setTimeout(() => resolveDone(), 2500);
});

ws.on("message", (raw) => { received.push(JSON.parse(raw.toString())); });
ws.on("error", (e) => { console.error("ws error:", e.message); process.exit(1); });

await done;
clearTimeout(timeout);

// Cleanup: delete test song and show.
try {
  if (ws.readyState === WebSocket.OPEN) {
    s({ type: "delete_show", showId: SHOW_ID });
    s({ type: "delete_song", songId: SONG_ID });
    await new Promise((r) => setTimeout(r, 100));
  }
} catch {
  // best-effort
}
ws.close();

const matches = received.filter((m) => m.type === "stt_match");
const states = received.filter((m) => m.type === "state" && m.channel === "program");
const listeners = received.filter((m) => m.type === "stt_listener_state");

const expectations = {
  listener_state_emitted: listeners.length >= 1 &&
    listeners.some((m) => m.listeners.some((l) => l.audioSourceId === "stt-smoke" && l.online)),
  match_for_a2_with_trust_off: matches.some(
    (m) => m.suggestedSlide?.sectionIdx === 0 && m.suggestedSlide?.slideIdx === 1 && m.confidence >= 0.5,
  ),
  cursor_did_not_advance_with_trust_off: (() => {
    const trustOnIdx = received.findIndex(
      (m) => m.type === "state" && m.channel === "program" && m.state.songSession?.trustMode === true,
    );
    if (trustOnIdx < 0) return false;
    const beforeTrust = received.slice(0, trustOnIdx).filter(
      (m) => m.type === "state" && m.channel === "program" && m.state.songSession,
    );
    return beforeTrust.every(
      (m) => m.state.songSession?.cursor.sectionIdx === 0 && m.state.songSession?.cursor.slideIdx === 0,
    );
  })(),
  match_for_chorus_with_trust_on: matches.some(
    (m) => m.suggestedSlide?.sectionIdx === 1 && m.suggestedSlide?.slideIdx === 0 && m.confidence >= 0.5,
  ),
  cursor_advanced_to_chorus_via_trust: states.some(
    (m) => m.state.songSession?.cursor.sectionIdx === 1 && m.state.songSession?.cursor.slideIdx === 0,
  ),
};

let ok = true;
for (const [k, v] of Object.entries(expectations)) {
  console.log(v ? `  ✓ ${k}` : `  ✗ ${k}`);
  if (!v) ok = false;
}

if (ok) {
  console.log("PASS: stt-smoke");
  process.exit(0);
} else {
  console.error("FAIL: see ✗ above");
  console.error("matches:", JSON.stringify(matches.map((m) => ({
    confidence: m.confidence, slide: m.suggestedSlide, hypothesis: m.hypothesis,
  })), null, 2));
  console.error("session states:", JSON.stringify(states.map((m) => m.state.songSession ?? null), null, 2));
  process.exit(1);
}
