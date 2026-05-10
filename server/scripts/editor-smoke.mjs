// Editor round-trip smoke: get a template, modify it, save, get again, verify the change persisted.
import { WebSocket } from "ws";

const url = process.env.WS_URL ?? "ws://localhost:4000/ws";
const ws = new WebSocket(url);
const received = [];

let resolveDone;
const done = new Promise((r) => (resolveDone = r));
const timeout = setTimeout(() => {
  console.error("FAIL: editor smoke timed out");
  console.error("received types:", received.map((m) => m.type));
  process.exit(1);
}, 6000);

function s(msg) {
  ws.send(JSON.stringify(msg));
}

let original;

ws.on("open", () => {
  s({ type: "get_template", templateId: "name-card" });
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  received.push(msg);

  if (msg.type === "template" && msg.template.id === "name-card" && !original) {
    original = msg.template;
    // Modify a layer's color and save.
    const next = JSON.parse(JSON.stringify(original));
    const plate = findLayerById(next.layers, "card-plate");
    if (!plate) {
      console.error("FAIL: could not find card-plate layer");
      process.exit(1);
    }
    plate.fill = { kind: "solid", color: "#0066ff" };
    next.name = original.name + " · edited";
    s({ type: "save_template", template: next });
    setTimeout(() => s({ type: "get_template", templateId: "name-card" }), 300);
    setTimeout(() => resolveDone(), 1500);
  }
});

ws.on("error", (e) => {
  console.error("ws error:", e.message);
  process.exit(1);
});

function findLayerById(layers, id) {
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.type === "group") {
      const f = findLayerById(l.children, id);
      if (f) return f;
    }
  }
  return null;
}

await done;
clearTimeout(timeout);
ws.close();

const ack = received.find((m) => m.type === "ack" && m.op === "save_template");
const broadcastTpl = received.filter((m) => m.type === "template" && m.template.id === "name-card");
const lastTpl = broadcastTpl[broadcastTpl.length - 1];
const expectedColor = "#0066ff";

const expectations = {
  ack_received: !!ack,
  template_broadcast_after_save: broadcastTpl.length >= 2,
  edit_persisted_in_memory: lastTpl?.template.name?.endsWith("· edited"),
  fill_color_applied: findLayerById(lastTpl?.template.layers ?? [], "card-plate")?.fill?.color === expectedColor,
};

let ok = true;
for (const [k, v] of Object.entries(expectations)) {
  console.log(v ? `  ✓ ${k}` : `  ✗ ${k}`);
  if (!v) ok = false;
}

// Restore the template to its previous content so this test is idempotent.
if (original) {
  const restoreWs = new WebSocket(url);
  await new Promise((r) => restoreWs.on("open", r));
  restoreWs.send(JSON.stringify({ type: "save_template", template: original }));
  await new Promise((r) => setTimeout(r, 400));
  restoreWs.close();
}

if (ok) {
  console.log("PASS: editor save round-trip");
  process.exit(0);
} else {
  console.error("FAIL");
  process.exit(1);
}
