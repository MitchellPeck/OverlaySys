# OverlaySys Companion Module

Connects Bitfocus Companion to an OverlaySys server over WebSocket.

## Installation (developer mode)

1. Build the module: `pnpm -F @overlaysys/companion-module build`
2. In Companion → Modules → Developer modules, point at the `packages/companion-module/` directory.
3. Add a new connection with type **OverlaySys**.

## Configuration

- **Host** — IP/hostname of the OverlaySys server (default `127.0.0.1`).
- **Port** — Port of the OverlaySys server (default `4000`).
- **Subscribed channels** — Comma-separated channel IDs to subscribe to (default `program,preview`).
- **Loaded show ID** — Optional. The show to drive `rundown_*` variables from. Pickable at runtime via the `Load Show` action; this field just persists the choice across Companion restarts.

See spec at `docs/superpowers/specs/2026-05-12-companion-integration-design.md` for the full action / variable / feedback reference.
