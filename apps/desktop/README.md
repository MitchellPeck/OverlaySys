# OverlaySys desktop

Electron host that wraps OverlaySys: operator UI as the main window, optional per-channel renderer windows for projection / fill+key / preview.

## Modes

### Dev mode

Assumes `pnpm dev` is already running with the Fastify server on `:4000`, the operator on `:3000`, and the renderer on `:3001`.

```bash
pnpm dev          # in one terminal
pnpm desktop      # in another
```

The Electron host opens the operator at `http://localhost:3000` with `?server=ws://localhost:4000/ws` so the operator's WS client connects to the right server. Channel windows open with the same pattern but pointing at the renderer.

### Production mode

The Electron host fork-spawns the Fastify server using its own bundled Node (via `ELECTRON_RUN_AS_NODE`), with these env overrides:

| Env var | Purpose |
|---|---|
| `PORT=0` | OS-assigned ephemeral port; multiple instances don't collide |
| `OVERLAYSYS_DATA_DIR=<userData>/data` | Per-user JSON storage (templates/shows/channels/songs/stt config) |
| `OVERLAYSYS_FIXTURES_DIR=<resources>/app/data` | Bundled fixtures, seeded into userData on first run |
| `OVERLAYSYS_LISTENER_PATH=<resources>/app/apps/lyric-listener/src/stdin.mjs` | Path to the STT listener daemon |
| `OVERLAYSYS_STATIC_OPERATOR_DIR=<resources>/app/apps/operator/out` | Operator static export served at `/operator/*` |
| `OVERLAYSYS_STATIC_RENDERER_DIR=<resources>/app/apps/renderer/dist` | Renderer static build served at `/renderer/*` |

The server emits a magic stdout line `OVERLAYSYS_PORT=<n>` once it's bound. The Electron main parses that, then loads the operator at `http://127.0.0.1:<port>/operator/?server=ws://127.0.0.1:<port>/ws` — same origin for HTTP and WS, no port management needed in the operator code.

## Per-channel windows

The operator's `/channels` page (and the channel cards in the show page's right rail) gain a **⧉ pop out** button when running in Electron. Clicking it spawns a new BrowserWindow loading the renderer at `?channel=<id>`.

Window options at open time (via `window.overlaysys.openChannelWindow(id, opts)`):

| Option | Effect |
|---|---|
| `frameless` | No title bar / chrome — looks like raw projection output |
| `transparent` | Transparent background — for chroma key replacement on macOS |
| `alwaysOnTop` | Floats above other windows |
| `fullscreen` | Opens fullscreen on the current display |

`alwaysOnTop` and `fullscreen` can be toggled at runtime via `setChannelWindowOptions`. `frameless` and `transparent` require window recreate.

## Packaging (TODO — current state is scaffolded but not yet shippable)

```bash
pnpm --filter @overlaysys/desktop package
```

Runs:
1. `next build` with `NEXT_BUILD_STATIC=1` → `apps/operator/out/`
2. `vite build` → `apps/renderer/dist/`
3. `tsc` for the Electron main + preload → `apps/desktop/dist/`
4. Stages a runtime tree at `apps/desktop/build/staged/` containing the server source, workspace packages, lyric-listener, static frontends, and fixtures
5. `electron-builder` packages it per platform → `apps/desktop/build/release/`

### Known TODOs before shippable

- The staged tree references workspace packages via the source tree but doesn't yet `pnpm install --prod` inside itself, so the resulting bundle is missing `node_modules`. To finish: extend `scripts/package-desktop.mjs` step 5 to `cd build/staged && pnpm install --prod --shamefully-hoist`. (Or bundle the server with esbuild into a single JS file with deps inlined — cleaner but more work.)
- Code signing (macOS notarization, Windows authenticode) — config slots are in place (`build.mac`, `build.win` in `package.json`) but no certificates wired up yet.
- Auto-update via `electron-updater` — not configured.
- Multi-monitor display picker UX in the operator — IPC supports it (`fullscreen`, future: `displayId`) but no UI yet.

## Architecture

```
                        ┌─────────────────────┐
                        │ Electron main       │
                        │  - spawns server    │──┐
                        │  - manages windows  │  │ child
                        └──────────┬──────────┘  │ process
                                   │             │
                        IPC ◄──────┘             ▼
                                       ┌────────────────────┐
                  ┌────────────────────│ Fastify server     │
                  │     loadURL        │  /ws (WebSocket)   │
                  ▼                    │  /api/* (HTTP)     │
        ┌──────────────────┐           │  /operator/*       │
        │ Operator window  │  ──ws──►  │  /renderer/*       │
        │  (BrowserWindow) │           └────────────────────┘
        └──────────────────┘                       ▲
                                                    │ ws
        ┌──────────────────┐                       │
        │ Channel window 1 │  ──────────ws─────────┤
        │  (BrowserWindow) │                       │
        └──────────────────┘                       │
        ┌──────────────────┐                       │
        │ Channel window N │  ──────────ws─────────┘
        │  (BrowserWindow) │
        └──────────────────┘
```

All HTTP/WS traffic is loopback. The operator and channel windows talk to the server via the same origin.
