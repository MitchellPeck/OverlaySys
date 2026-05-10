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
data/
  templates/     Template JSON files (gitignored except fixtures)
  shows/         Show / rundown JSON files
```

See `/Users/mitchellpeck/.claude/plans/build-a-custom-html-compiled-sundae.md` for the full plan.
