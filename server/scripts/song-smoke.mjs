// Phase A2 smoke: full song-session lifecycle over WS.
import { WebSocket } from "ws";

const url = process.env.WS_URL ?? "ws://localhost:4000/ws";
const ws = new WebSocket(url);

const received = [];
let resolveDone;
const done = new Promise((r) => (resolveDone = r));
const timeout = setTimeout(() => {
  console.error("FAIL: song-smoke timed out");
  console.error("received:", received.map((m) => m.type));
  process.exit(1);
}, 8000);

function s(msg) { ws.send(JSON.stringify(msg)); }

ws.on("open", () => {
  s({ type: "subscribe", channel: "program", role: "renderer" });

  setTimeout(() => s({
    type: "song_take",
    channel: "program",
    showId: "demo-show",
    songRowId: "row-amazing-grace",
  }), 100);

  setTimeout(() => s({ type: "song_advance", channel: "program", delta: 1 }), 300);
  setTimeout(() => s({ type: "song_jump", channel: "program", sectionId: "c" }), 500);
  setTimeout(() => s({ type: "song_jump_kind", channel: "program", kind: "verse", ordinal: 1 }), 700);
  setTimeout(() => s({ type: "song_blank", channel: "program" }), 900);
  setTimeout(() => s({ type: "song_blank", channel: "program" }), 1100);
  setTimeout(() => s({ type: "song_end", channel: "program" }), 1300);

  setTimeout(() => resolveDone(), 2000);
});

ws.on("message", (raw) => { received.push(JSON.parse(raw.toString())); });
ws.on("error", (e) => { console.error("ws error:", e.message); process.exit(1); });

await done;
clearTimeout(timeout);
ws.close();

const states = received.filter((m) => m.type === "state" && m.channel === "program");

const expectations = {
  initial_take_text: states.some(
    (m) => m.state.songSession && m.state.songSession.cursor.sectionIdx === 0 &&
           m.state.songSession.cursor.slideIdx === 0,
  ),
  advanced: states.some(
    (m) => m.state.songSession?.cursor.sectionIdx === 0 &&
           m.state.songSession?.cursor.slideIdx === 1,
  ),
  jumped_to_chorus: states.some(
    (m) => m.state.songSession?.arrangement[m.state.songSession.cursor.sectionIdx] === "c",
  ),
  jumped_back_to_v1: states.some(
    (m) => m.state.songSession?.arrangement[m.state.songSession.cursor.sectionIdx] === "v1",
  ),
  blanked_then_unblanked: (() => {
    const bs = states.map((m) => m.state.songSession?.blanked).filter((v) => v !== undefined);
    return bs.includes(true) && bs[bs.length - 1] === false;
  })(),
  session_ended: states.some(
    (m, i) => i === states.length - 1 && m.state.songSession === undefined,
  ),
};

let ok = true;
for (const [k, v] of Object.entries(expectations)) {
  console.log(v ? `  ✓ ${k}` : `  ✗ ${k}`);
  if (!v) ok = false;
}

if (ok) {
  console.log("PASS: song-smoke");
  process.exit(0);
} else {
  console.error("FAIL: see ✗ above");
  console.error("session states observed:", states.map((m) => m.state.songSession ?? null));
  process.exit(1);
}
