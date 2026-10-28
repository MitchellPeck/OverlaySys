# OverlaySys

Custom HTML broadcast graphics system. Replacement for H2R.

- React/Next.js operator UI
- GSAP-driven HTML renderer (browser source / NDI via Electron)
- WebSocket control protocol
- LAN-friendly: operator on a laptop, renderer on a separate render PC

## Quickstart

```bash
pnpm install
pnpm dev
```

That starts (in parallel):

| Service | URL | Purpose |
|---|---|---|
| `server` | `ws://localhost:4000` | WebSocket control + HTTP API |
| `operator` | `http://localhost:3000` | Operator UI (Next.js) |
| `renderer` | `http://localhost:3001` | Renderer page — point OBS Browser Source at `http://<render-pc>:3001/?channel=program` |

## Layout

```
apps/
  operator/      Next.js — show + design modes
  renderer/      Vite — the page OBS loads
server/          Fastify + ws
packages/
  core/          Shared types (Template, Show)
  ws-protocol/   Zod-validated WebSocket messages
  template-engine/  GSAP runtime that mounts a Template into the DOM
  editor-kit/    Reusable editor primitives (later phases)
  companion-module/  Bitfocus Companion module for Stream Deck control
data/
  templates/     Template JSON files (gitignored except fixtures)
  shows/         Show / rundown JSON files
```

See `/Users/mitchellpeck/.claude/plans/build-a-custom-html-compiled-sundae.md` for the full plan.

## Companion integration

A Bitfocus Companion module lives at `packages/companion-module/`. See [its HELP.md](packages/companion-module/companion/HELP.md) for install and usage, and the design spec at `docs/superpowers/specs/2026-05-12-companion-integration-design.md`.

## LAN security

The server listens on all interfaces so renderers, Companion and operator laptops on the LAN can reach it.

- **Origin check (always on).** Browsers may connect only from loopback, from this machine's own LAN address or hostname (any port), or from an origin listed in `OVERLAYSYS_ALLOWED_ORIGINS` (comma-separated `scheme://host:port`). Clients that send no `Origin` header (Companion, OBS, curl) are allowed.
- **LAN token (off by default).** Set `OVERLAYSYS_TOKEN=<secret>` in the environment, or `{"token": "<secret>"}` in `data/security/config.json`. Connections from other machines must then present it as `?token=<secret>` (WebSocket URL or the first page load; a cookie remembers it), `Authorization: Bearer <secret>`, or the Companion module's "LAN token" setting. Connections from the server machine never need it. `/health` answers without the token, but returns details only to authorized callers.
- **Machine-only operations.** Cloud/PCO credential pushes, whisper-cpp install/uninstall, model download/delete and the STT command configuration are accepted only from the server machine. Model downloads must be `https://` on huggingface.co or github.com (`OVERLAYSYS_STT_MODEL_HOSTS` adds hosts).
- WebSocket messages are capped at 128 MB (`OVERLAYSYS_WS_MAX_PAYLOAD_MB`). Media uploads go over HTTP and aren't affected.

## HTTP control API (v1)

For integrations that can't keep a WebSocket open, such as Stream Deck "website" buttons, switcher macros or scripts. Requests go through the same handlers as the WebSocket, and are subject to the same origin check and LAN token. Bodies are JSON. Responses are `{"ok": true}`, or `{"ok": false, "error": <code>, "message": …}` with status 400 (bad request) or 404 (unknown template/show).

| Method | Path | Body | Does |
| --- | --- | --- | --- |
| `POST` | `/api/v1/channels/:id/take` | `{"templateId": "lower-third", "data": {"name": "…"}}` | Take a template to the channel |
| `POST` | `/api/v1/channels/:id/clear` | `{"video": true}` (optional) | Animate the graphic out; `video: true` also hard-cuts the video |
| `GET` | `/api/v1/channels/:id/state` |  | Channel state plus connected output count |
| `POST` | `/api/v1/channels/clear-all` | `{"video": false}` (optional) | Panic: clear every channel (mirrors follow their source) and cut all video unless `video: false` |
| `POST` | `/api/v1/song/advance` | `{"channel": "program", "delta": 1}` | Next (or, with `-1`, previous) slide of the live song |
| `POST` | `/api/v1/stage/message` | `{"text": "5 minutes"}` | Show a stage-display message (empty text clears it) |
| `DELETE` | `/api/v1/stage/message` |  | Clear the stage message |

Example: `curl -X POST -H 'Authorization: Bearer $TOKEN' -H 'content-type: application/json' -d '{"templateId":"lower-third","data":{"name":"Jo"}}' http://studio.local:4000/api/v1/channels/program/take`

`GET /health` returns `version`, `protocolVersion`, `uptimeSec`, per-channel `outputs` (connected renderer windows), on-air `channels`, `stt` (spawner state, listeners online, last heard) and cloud `sync` status.

## Scripture

Scripture rundown rows pull verse text from translations registered in the server's `ScriptureProvider` registry. Public-domain KJV and WEB ship bundled in `@overlaysys/scripture` (always available, fully offline). To add a licensed translation (NIV, ESV, NLT, …) implement the `ScriptureProvider` interface and register it in `server/src/scripture.ts:initScripture()`.

See the design spec at `docs/superpowers/specs/2026-05-15-scripture-integration-design.md`.
