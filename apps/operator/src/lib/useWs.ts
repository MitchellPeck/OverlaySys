"use client";

import { WsClient, defaultServerUrl } from "./wsClient";
import { useStore } from "./store";
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
 */
function bootstrap(): void {
  if (bootstrapped || typeof window === "undefined") return;
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
        client.send({ type: "list_channels" });
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
      case "error":
        console.warn("[server error]", msg);
        break;
    }
  });

  client.connect();
}

export function useWs(): { send: (msg: ClientMessage) => void } {
  bootstrap();
  return { send: (msg) => getClient().send(msg) };
}
