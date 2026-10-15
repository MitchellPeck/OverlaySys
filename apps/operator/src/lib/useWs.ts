"use client";

import { WsClient, defaultServerUrl } from "./wsClient";
import { useStore } from "./store";
import { isCloudMode } from "./mode";
import type { ClientMessage } from "@overlaysys/ws-protocol";

const CHANNELS_TO_WATCH = ["program", "preview"] as const;

let singleton: WsClient | null = null;
let bootstrapped = false;

export function getClient(): WsClient {
  if (!singleton) {
    singleton = new WsClient(defaultServerUrl());
  }
  return singleton;
}

/**
 * Bootstrap the WS singleton: register listeners and open the connection.
 * Module-scoped so it runs exactly once per browser tab, regardless of how
 * many times useWs is mounted across page navigations.
 *
 * In cloud mode this is a no-op — there's no local WS server to connect
 * to. Cloud-mode pages read data through lib/cloudData.ts instead.
 */
function bootstrap(): void {
  if (bootstrapped || typeof window === "undefined") return;
  if (isCloudMode()) {
    // Mark bootstrapped so we don't keep re-entering, but skip the actual
    // connection. The store's `conn` field stays as "connecting" forever
    // in cloud mode; UI gates that surface a WS connection state check it
    // via isCloudMode() instead (Phase 3 components).
    bootstrapped = true;
    return;
  }
  bootstrapped = true;
  const client = getClient();

  client.onStatus((s) => useStore.getState().setConn(s));

  client.on((msg) => {
    const store = useStore.getState();
    switch (msg.type) {
      case "hello":
        for (const ch of CHANNELS_TO_WATCH) {
          client.send({ type: "subscribe", channel: ch, role: "operator" });
        }
        client.send({ type: "list_templates" });
        client.send({ type: "list_shows" });
        client.send({ type: "list_songs" });
        client.send({ type: "list_hotcards" });
        client.send({ type: "list_channels" });
        client.send({ type: "list_projects" });
        client.send({ type: "stt_spawner_get_config" });
        break;
      case "state":
        store.setChannelState(msg.state);
        store.setSongSession(msg.state.channel, msg.state.songSession ?? null);
        break;
      case "template_list":
        store.setTemplates(msg.templates);
        break;
      case "template":
        store.setTemplate(msg.template);
        break;
      case "show_list":
        store.setShowMetas(msg.shows);
        break;
      case "song_list":
        store.setSongs(msg.songs);
        break;
      case "song":
        store.setSong(msg.song);
        break;
      case "show":
        if (!store.show || store.show.id === msg.show.id) store.setShow(msg.show);
        store.setShowFull(msg.show);
        break;
      case "hotcard_list":
        store.setHotcards(msg.hotcards);
        break;
      case "hotcard":
        store.setHotcard(msg.hotcard);
        break;
      case "project_list":
        store.setProjects(msg.projects);
        break;
      case "project":
        // Re-fetch the full list so additions and renames show up everywhere
        // a `projects` selector is mounted — the discriminated union doesn't
        // give us a per-id update store slice today.
        client.send({ type: "list_projects" });
        break;
      case "channel_list":
        store.setChannelConfigs(msg.configs);
        // Subscribe to every configured channel so the operator UI can show
        // live status for all of them. The server dedupes subscribes so
        // re-running this on every channel_list update is fine.
        for (const c of msg.configs) {
          client.send({ type: "subscribe", channel: c.id, role: "operator" });
        }
        break;
      case "stt_match":
        store.setSttMatch(msg.channel, msg.suggestedSlide ? {
          sectionIdx: msg.suggestedSlide.sectionIdx,
          slideIdx: msg.suggestedSlide.slideIdx,
          confidence: msg.confidence,
          hypothesis: msg.hypothesis,
          strategy: msg.strategy,
          matchedTokens: msg.matchedTokens,
          coverage: msg.coverage,
          latencyMs: msg.latencyMs,
          isFinal: msg.isFinal,
        } : null);
        break;
      case "stt_listener_state":
        store.setSttListeners(msg.listeners);
        break;
      case "stt_spawner_status":
        store.setSttSpawnerStatus(msg.status);
        break;
      case "stt_spawner_config":
        store.setSttSpawnerConfig(msg.config);
        break;
      case "stt_presence":
        store.setSttPresence(msg.presence);
        break;
      case "stt_models":
        store.setSttModels(msg.models, msg.modelsDir);
        break;
      case "stt_capture_devices":
        store.setSttCaptureDevices(msg.devices);
        break;
      case "stt_install_progress":
        store.setSttInstallProgress(msg.progress);
        break;
      case "error":
        console.warn("[server error]", msg);
        break;
    }
  });

  client.connect();
}

// Both handles are module constants, NOT rebuilt per call. Nearly every
// data-fetching effect in the operator lists `send` in its dependency array
// (`useEffect(..., [conn, send])`), so a fresh closure per render would make
// those effects re-run on every render — and because the effect's own
// responses land in the store, that re-render produces yet another `send`,
// re-firing the effect. The resulting feedback loop pegs the renderer and
// hammers the server: on the STT page each iteration re-read
// data/stt/config.json until the server ran out of file descriptors and
// spawn("bash", …) failed with EBADF, so STT could never start.
//
// getClient() is itself a lazy singleton, so resolving it inside the closure
// (rather than at module scope) keeps the WS from being constructed during
// SSR/import while still giving callers one stable function identity.
const WS_HANDLE = { send: (msg: ClientMessage) => getClient().send(msg) };
// No WS in cloud mode. A no-op send keeps existing call sites type-safe
// while we migrate them to cloud-aware data paths page by page.
const CLOUD_HANDLE = { send: () => {} };

export function useWs(): { send: (msg: ClientMessage) => void } {
  bootstrap();
  return isCloudMode() ? CLOUD_HANDLE : WS_HANDLE;
}
