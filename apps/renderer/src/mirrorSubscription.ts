import type { ChannelConfig } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";

/**
 * Pure subscription state for one renderer window.
 *
 * A renderer is addressed by the `channel` in its URL, but the state it
 * actually paints comes from its *source* channel — itself by default, or
 * the channel named by `mirrorOf` in its config (the fill+key pattern:
 * `alpha-program` mirrors `program` in matte mode).
 *
 * Kept out of the React component because every bug in this area has been
 * a sequencing bug across reconnects and late-arriving config, and those
 * are only cheap to pin down as table tests over message sequences:
 *
 *   - The WS drops and reconnects (server restart, sleep/wake, network
 *     blip). The server's per-socket subscription map starts empty, so
 *     EVERY subscription has to be re-sent — including the mirror source.
 *     The first version re-sent only the URL channel and skipped the
 *     source because "it hadn't changed"; the alpha output then sat black
 *     (or frozen on its last frame) for the rest of the session while
 *     program kept working.
 *   - The config arrives late or changes (fresh install before fixtures
 *     land, a sync pass pulling a new mirrorOf, an operator edit). The
 *     source has to follow it, including reverting to self when mirrorOf
 *     is cleared.
 *
 * The object never talks to a socket. `hello`/`channelConfig`/… return the
 * messages the caller should send, and `accepts` answers "is this state
 * message for my source?"
 */
export interface MirrorSubscription {
  /** Channel from the URL — what this window IS. */
  readonly channel: string;
  /** Channel whose runtime state is painted — what this window SHOWS. */
  readonly source: string;
  /** Last config received for `channel`, if any. */
  readonly config: ChannelConfig | null;
  /**
   * Fresh socket (first connect or any reconnect). Subscribe to the URL
   * channel, re-subscribe to the current source when it differs, and ask
   * for config again so a changed mirrorOf is picked up.
   */
  hello(): ClientMessage[];
  /**
   * A `channel` message. Ignored unless it is for `channel`. Retargets the
   * source when mirrorOf changed; returns the subscribe needed (if any).
   */
  channelConfig(config: ChannelConfig): ClientMessage[];
  /**
   * A `channel_list` broadcast. The server sends this to every socket after
   * sync pulls and operator edits but never a per-channel `channel`, so it
   * is the only way an already-open window learns about a config that
   * landed after it asked. Same effect as `channelConfig` for our entry.
   */
  channelList(configs: ChannelConfig[]): ClientMessage[];
  /** Should a `state` message for `stateChannel` be applied? */
  accepts(stateChannel: string): boolean;
}

export function createMirrorSubscription(channel: string): MirrorSubscription {
  let source = channel;
  let config: ChannelConfig | null = null;

  function subscribe(target: string): ClientMessage {
    return { type: "subscribe", channel: target, role: "renderer" };
  }

  function retarget(next: ChannelConfig): ClientMessage[] {
    config = next;
    const wanted = next.mirrorOf && next.mirrorOf !== channel ? next.mirrorOf : channel;
    if (wanted === source) return [];
    source = wanted;
    // Subscribing to our own channel again is a no-op on the server (and
    // harmless); the URL channel was subscribed on hello.
    return wanted === channel ? [] : [subscribe(wanted)];
  }

  return {
    get channel() {
      return channel;
    },
    get source() {
      return source;
    },
    get config() {
      return config;
    },
    hello() {
      const out: ClientMessage[] = [subscribe(channel)];
      if (source !== channel) out.push(subscribe(source));
      out.push({ type: "get_channel", channelId: channel });
      return out;
    },
    channelConfig(next) {
      if (next.id !== channel) return [];
      return retarget(next);
    },
    channelList(configs) {
      const mine = configs.find((c) => c.id === channel);
      if (!mine) return [];
      return retarget(mine);
    },
    accepts(stateChannel) {
      return stateChannel === source;
    },
  };
}
