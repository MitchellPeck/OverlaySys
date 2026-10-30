"use client";

import { useSyncExternalStore } from "react";
import { WsClient, defaultServerUrl, type WsStatus } from "./wsClient";
import { useStore } from "./store";
// [P3.13]
import { requestedDecks } from "./deckRequests";
// [/P3.13]
import { isCloudMode } from "./mode";
// [P2a.22]
import { attachStageLayoutStatusFeed, resetStageLayoutStatus } from "./stageLayoutStatus";
// [/P2a.22]
import type { ClientMessage, OutputsState } from "@overlaysys/ws-protocol";

const CHANNELS_TO_WATCH = ["program", "preview"] as const;

let singleton: WsClient | null = null;
let bootstrapped = false;

// ── Output presence (outputs_state) ─────────────────────────────────────
// Kept here rather than in the zustand store: it is one server message with
// one reader (the channel dots), and null means "unknown" (disconnected or
// a server too old to send it), which callers must not show as "offline".
let outputsState: OutputsState | null = null;
const outputsListeners = new Set<() => void>();
function setOutputsState(next: OutputsState | null): void {
  outputsState = next;
  for (const l of outputsListeners) l();
}
function subscribeOutputs(l: () => void): () => void {
  outputsListeners.add(l);
  return () => {
    outputsListeners.delete(l);
  };
}

/** Connected renderer windows per channel; null while unknown. */
export function useOutputs(): OutputsState | null {
  return useSyncExternalStore(subscribeOutputs, () => outputsState, () => null);
}

function subscribeStatus(l: () => void): () => void {
  if (isCloudMode()) return () => {};
  return getClient().onStatus(() => l());
}

/** Live WS status ("connecting" | "open" | "closed"); "closed" in cloud mode. */
export function useWsStatus(): WsStatus {
  return useSyncExternalStore(
    subscribeStatus,
    () => (isCloudMode() ? "closed" : getClient().getStatus()),
    () => "connecting",
  );
}

/** Drop the socket and dial the server again now (skips any backoff wait). */
export function reconnectNow(): void {
  if (typeof window === "undefined" || isCloudMode()) return;
  bootstrap();
  getClient().reconnectNow();
}

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
  // [P2a.22]
  attachStageLayoutStatusFeed(client);
  // [/P2a.22]

  client.onStatus((s) => {
    useStore.getState().setConn(s);
    if (s !== "open") setOutputsState(null);
    // [P2a.22]
    if (s !== "open") resetStageLayoutStatus();
    // [/P2a.22]
  });

  client.on((msg) => {
    const store = useStore.getState();
    switch (msg.type) {
      case "hello":
        store.setServerTimeOffset(msg.serverTime - Date.now());
        for (const ch of CHANNELS_TO_WATCH) {
          client.send({ type: "subscribe", channel: ch, role: "operator" });
        }
        client.send({ type: "list_templates" });
        client.send({ type: "list_stage_layouts" });
        client.send({ type: "list_shows" });
        client.send({ type: "list_songs" });
        // [P3.13]
        client.send({ type: "list_decks" });
        store.resetDeckLookups();
        // [/P3.13]
        client.send({ type: "list_hotcards" });
        client.send({ type: "list_channels" });
        client.send({ type: "list_projects" });
        client.send({ type: "stt_spawner_get_config" });
        // STT suggestions are opt-in per socket (renderers never get them).
        client.send({ type: "stt_match_subscribe", on: true });
        break;
      case "state":
        store.setChannelState(msg.state);
        store.setSongSession(msg.state.channel, msg.state.songSession ?? null);
        break;
      case "stage_state":
        store.setStageState(msg);
        break;
      case "timers_state":
        store.setStageTimers(msg.timers);
        break;
      case "pco_live_state":
        store.setPcoLive(msg);
        break;
      case "outputs_state":
        setOutputsState(msg.outputs);
        break;
      case "media_playback":
        store.applyMediaPlayback(msg.channel, msg.takenAt, msg.playback);
        break;
      case "stage_layout_list":
        store.setStageLayouts(msg.layouts);
        break;
      case "stage_layout_previews":
        store.setStageLayoutPreviews(msg.previews);
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
      // [P3.13]
      case "deck_list":
        store.setDecks(msg.decks);
        break;
      case "deck":
        store.upsertDeck(msg.deck);
        break;
      case "song_converted":
        store.setLastSongConversion(msg);
        break;
      // [/P3.13]
      case "song":
        store.setSong(msg.song);
        break;
      case "show":
        // Only the loaded show or the one Live asked for; an export or
        // editor fetch must not pick which show Live loads.
        store.receiveShow(msg.show);
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
        store.setSttMatch(msg.channel, {
          suggestedSlide: msg.suggestedSlide
            ? { sectionIdx: msg.suggestedSlide.sectionIdx, slideIdx: msg.suggestedSlide.slideIdx }
            : null,
          confidence: msg.confidence,
          hypothesis: msg.hypothesis,
          strategy: msg.strategy,
          matchedTokens: msg.matchedTokens,
          coverage: msg.coverage,
          latencyMs: msg.latencyMs,
          isFinal: msg.isFinal,
        });
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
        store.setSttInputDevices(msg.inputDevices ?? null);
        break;
      case "stt_levels":
        store.setSttLevels({ levels: msg.levels, channels: msg.channels });
        break;
      case "stt_install_progress":
        store.setSttInstallProgress(msg.progress);
        break;
      case "error":
        // A refused "Follow PCO Live" is shown next to its toggle.
        // [P3.13] a get_deck we sent came back not_found
        if (msg.code === "not_found" && requestedDecks.has(msg.message)) store.markDeckNotFound(msg.message);
        // [/P3.13]
        else if (msg.code === "pco_live") store.setPcoLiveStartError(msg.message);
        else console.warn("[server error]", msg);
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
