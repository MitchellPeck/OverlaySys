import type { ChannelState, Template } from "@overlaysys/core";

/** The slice of template-engine's MountedTemplate the player drives. */
export interface PlayerMount {
  playIn(): Promise<void>;
  playOut(): Promise<void>;
  playOutTimeline(): Promise<void>;
  update(data: Record<string, string>): void;
  destroy(): void;
}

export interface ChannelPlayerDeps<M extends PlayerMount> {
  loadTemplate(id: string): Promise<Template>;
  mount(template: Template, data: Record<string, string>): M;
  /** A session-start fade is armed; same-template swaps must remount instead. */
  sessionStartPending?(): boolean;
  /** Called right before a fresh mount. Returns true when it consumed a session start. */
  beforeFreshMount?(): boolean;
  /** Called right after a fresh mount (blink, session-start ramp). */
  afterFreshMount?(template: Template, mount: M, sessionStart: boolean): void;
  onLoadError?(templateId: string, err: unknown): void;
}

export interface ChannelPlayer {
  apply(state: ChannelState): Promise<void>;
  /** Tear everything down now, without animation (stage channel, unmount). */
  reset(): void;
  /** True while a take is waiting on its template. */
  readonly loading: boolean;
  /** Size of the template currently on screen, if any. */
  readonly currentTemplate: Template | null;
}

/**
 * Applies channel `state` messages to the template stage.
 *
 * Kept out of Renderer.tsx so the sequencing is unit-tested. The rules:
 *
 *   - A take's previous graphic starts its Out the moment the take arrives,
 *     independent of the new template's load. If that load fails (not_found,
 *     timeout) the stage ends up empty rather than frozen on the old graphic.
 *   - Every take / clear bumps a generation; an async step that finds the
 *     generation moved on abandons its work. A Clear (phase "out" or a null
 *     `active`) therefore cancels a take still waiting on its template — the
 *     old code only compared takenAt, which a clear does not change, so the
 *     template mounted after the clear and stuck.
 *   - Retiring a mount is idempotent: Out runs once, then destroy.
 */
export function createChannelPlayer<M extends PlayerMount>(deps: ChannelPlayerDeps<M>): ChannelPlayer {
  let current: { mount: M; template: Template } | null = null;
  let lastTakenAt = 0;
  let gen = 0;
  let loading = false;
  /** Latest data for the take in flight, so an update during a load isn't lost. */
  let latestData: Record<string, string> = {};
  const retiring = new Map<M, Promise<void>>();
  const destroyed = new WeakSet<M>();

  function safeDestroy(m: M): void {
    if (destroyed.has(m)) return;
    destroyed.add(m);
    try {
      m.destroy();
    } catch (err) {
      console.warn("[renderer] destroy failed", err);
    }
  }

  function retire(m: M): Promise<void> {
    const existing = retiring.get(m);
    if (existing) return existing;
    const p = m
      .playOut()
      .catch(() => {})
      .then(() => {
        retiring.delete(m);
        safeDestroy(m);
      });
    retiring.set(m, p);
    return p;
  }

  function retireCurrent(): Promise<void> {
    const prev = current;
    current = null;
    return prev ? retire(prev.mount) : Promise.resolve();
  }

  async function apply(state: ChannelState): Promise<void> {
    if (!state.active) {
      gen++;
      loading = false;
      await retireCurrent();
      return;
    }

    const { templateId, data, phase, takenAt } = state.active;

    if (takenAt === lastTakenAt) {
      if (phase === "out") {
        // Clear: cancels a take still loading and plays the mount out.
        gen++;
        loading = false;
        await retireCurrent();
        return;
      }
      latestData = data;
      current?.mount.update(data);
      return;
    }

    lastTakenAt = takenAt;
    const myGen = ++gen;
    latestData = data;

    if (phase === "out") {
      // A take we never saw go in (e.g. reconnect mid-clear): nothing new to show.
      loading = false;
      await retireCurrent();
      return;
    }

    // Same-template swap: lyric slide advance, or an outro/intro reusing the
    // template. Reuse the mount and run only its own out timeline → data swap
    // → in, so layers outside the in/out timelines stay put. A pending
    // session start wants the full remount for its stage fade.
    if (current && current.template.id === templateId && !(deps.sessionStartPending?.() ?? false)) {
      const m = current.mount;
      loading = false;
      await m.playOutTimeline().catch(() => {});
      if (myGen !== gen) return;
      m.update(latestData);
      await m.playIn().catch(() => {});
      return;
    }

    // Different template (or nothing up): previous goes out now, in parallel
    // with the load. The new one mounts once both are done.
    const out = retireCurrent();
    loading = true;
    let tpl: Template;
    try {
      tpl = await deps.loadTemplate(templateId);
    } catch (err) {
      if (myGen === gen) loading = false;
      deps.onLoadError?.(templateId, err);
      return;
    }
    await out;
    if (myGen !== gen) return;
    loading = false;

    const sessionStart = deps.beforeFreshMount?.() ?? false;
    const m = deps.mount(tpl, latestData);
    current = { mount: m, template: tpl };
    m.playIn().catch(() => {});
    deps.afterFreshMount?.(tpl, m, sessionStart);
  }

  return {
    apply,
    reset() {
      gen++;
      loading = false;
      lastTakenAt = 0;
      const prev = current;
      current = null;
      if (prev) safeDestroy(prev.mount);
      for (const m of [...retiring.keys()]) safeDestroy(m);
      retiring.clear();
    },
    get loading() {
      return loading;
    },
    get currentTemplate() {
      return current?.template ?? null;
    },
  };
}
