// Phase 1+2+3 smoke test: WS protocol, storage, PVW→PGM swap.
import { WebSocket } from "ws";

const url = process.env.WS_URL ?? "ws://localhost:4000/ws";
const ws = new WebSocket(url);

const received = [];
let resolveDone;
const done = new Promise((r) => (resolveDone = r));
const timeout = setTimeout(() => {
  console.error("FAIL: smoke test timed out after 8s");
  console.error("received:", received.map((m) => m.type));
  process.exit(1);
}, 8000);

function s(msg) {
  ws.send(JSON.stringify(msg));
}

ws.on("open", () => {
  // Phase 1: subscribe + take + clear on program.
  s({ type: "subscribe", channel: "program", role: "renderer" });
  s({ type: "subscribe", channel: "preview", role: "renderer" });

  // Phase 2: storage round-trip.
  setTimeout(() => s({ type: "list_templates" }), 50);
  setTimeout(() => s({ type: "get_template", templateId: "lower-third-default" }), 100);
  setTimeout(() => s({ type: "list_shows" }), 150);
  setTimeout(() => s({ type: "get_show", showId: "demo-show" }), 200);
  setTimeout(() => s({ type: "list_songs" }), 250);
  setTimeout(() => s({ type: "get_song", songId: "amazing-grace" }), 280);

  // Phase 1: take/clear on program.
  setTimeout(
    () =>
      s({
        type: "take",
        channel: "program",
        templateId: "lower-third-default",
        data: { name: "Smoke", title: "Phase 1+2+3" },
      }),
    300,
  );
  setTimeout(() => s({ type: "clear", channel: "program" }), 500);

  // Phase 3: PVW→PGM swap.
  setTimeout(
    () =>
      s({
        type: "cue",
        channel: "preview",
        templateId: "name-card",
        data: { name: "Cued for swap" },
      }),
    2200,
  );
  setTimeout(
    () =>
      s({
        type: "take_pvw_to_pgm",
        fromChannel: "preview",
        toChannel: "program",
      }),
    2400,
  );

  setTimeout(() => resolveDone(), 4500);
});

ws.on("message", (raw) => {
  received.push(JSON.parse(raw.toString()));
});
ws.on("error", (e) => {
  console.error("ws error:", e.message);
  process.exit(1);
});

await done;
clearTimeout(timeout);
ws.close();

// --- Assertions ---
const types = received.map((m) => m.type);
const expectations = {
  hello: types.includes("hello"),
  template_list: received.some(
    (m) => m.type === "template_list" && m.templates.length >= 3,
  ),
  template_lower_third: received.some(
    (m) => m.type === "template" && m.template.id === "lower-third-default",
  ),
  show_list: received.some((m) => m.type === "show_list" && m.shows.length >= 1),
  show_demo: received.some((m) => m.type === "show" && m.show.id === "demo-show"),
  song_list: received.some(
    (m) => m.type === "song_list" && m.songs.length >= 1,
  ),
  song_amazing_grace: received.some(
    (m) => m.type === "song" && m.song.id === "amazing-grace",
  ),
  take_in: received.some(
    (m) =>
      m.type === "state" &&
      m.channel === "program" &&
      m.state.active?.phase === "in" &&
      m.state.active?.data?.name === "Smoke",
  ),
  cleared_program: received.some(
    (m) => m.type === "state" && m.channel === "program" && m.state.active === null,
  ),
  preview_cued: received.some(
    (m) =>
      m.type === "state" &&
      m.channel === "preview" &&
      m.state.active?.templateId === "name-card",
  ),
  pgm_after_swap: received.some(
    (m) =>
      m.type === "state" &&
      m.channel === "program" &&
      m.state.active?.templateId === "name-card",
  ),
  pvw_cleared_after_swap: received.filter(
    (m) => m.type === "state" && m.channel === "preview" && m.state.active === null,
  ).length >= 2,
};

let ok = true;
for (const [k, v] of Object.entries(expectations)) {
  console.log(v ? `  ✓ ${k}` : `  ✗ ${k}`);
  if (!v) ok = false;
}

if (ok) {
  console.log("PASS: all phase 1+2+3 expectations met");
  process.exit(0);
} else {
  console.error("FAIL: see ✗ marks above");
  console.error("messages:", types);
  process.exit(1);
}
