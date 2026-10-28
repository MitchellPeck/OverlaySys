import type { Template } from "@overlaysys/core";

/**
 * Template fetches for one renderer window, kept out of Renderer.tsx so the
 * failure paths are unit-tested.
 *
 * The first version kept a list of resolvers per id and never rejected: a
 * `not_found` for the id, a request dropped while the socket was down, or a
 * server that never answered left the take's promise pending forever. The
 * previous graphic was only torn down after that promise settled, so it
 * stayed on air and Clear couldn't reach it. Every request now settles:
 * with the template, with a `not_found` for that id, or after a timeout.
 */
export interface TemplateLoader {
  /** Cached template, or a request that settles within `timeoutMs`. */
  get(id: string): Promise<Template>;
  /** A `template` message (an answer or a broadcast save): cache + resolve. */
  received(template: Template): void;
  /** A `not_found` error. Rejects only if `id` is a pending template request. */
  notFound(id: string): boolean;
  /** Fresh socket: requests sent on the dead one are lost, so send them again. */
  resend(): void;
  /** Ids still waiting for an answer. */
  pendingIds(): string[];
  /** Reject everything pending (window teardown). */
  dispose(): void;
}

export class TemplateLoadError extends Error {
  constructor(
    readonly templateId: string,
    readonly reason: "not_found" | "timeout" | "disposed",
  ) {
    super(`template ${templateId}: ${reason}`);
    this.name = "TemplateLoadError";
  }
}

type Pending = {
  resolvers: { resolve: (t: Template) => void; reject: (e: Error) => void }[];
  timer: ReturnType<typeof setTimeout>;
};

export const TEMPLATE_LOAD_TIMEOUT_MS = 5000;

export function createTemplateLoader(opts: {
  request: (id: string) => void;
  timeoutMs?: number;
}): TemplateLoader {
  const timeoutMs = opts.timeoutMs ?? TEMPLATE_LOAD_TIMEOUT_MS;
  const cache = new Map<string, Template>();
  const pending = new Map<string, Pending>();

  function fail(id: string, reason: TemplateLoadError["reason"]): boolean {
    const p = pending.get(id);
    if (!p) return false;
    pending.delete(id);
    clearTimeout(p.timer);
    const err = new TemplateLoadError(id, reason);
    for (const r of p.resolvers) r.reject(err);
    return true;
  }

  function arm(id: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => fail(id, "timeout"), timeoutMs);
  }

  return {
    get(id) {
      const cached = cache.get(id);
      if (cached) return Promise.resolve(cached);
      return new Promise<Template>((resolve, reject) => {
        const existing = pending.get(id);
        if (existing) {
          existing.resolvers.push({ resolve, reject });
          return;
        }
        pending.set(id, { resolvers: [{ resolve, reject }], timer: arm(id) });
        opts.request(id);
      });
    },
    received(template) {
      cache.set(template.id, template);
      const p = pending.get(template.id);
      if (!p) return;
      pending.delete(template.id);
      clearTimeout(p.timer);
      for (const r of p.resolvers) r.resolve(template);
    },
    notFound(id) {
      return fail(id, "not_found");
    },
    resend() {
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.timer = arm(id);
        opts.request(id);
      }
    },
    pendingIds() {
      return [...pending.keys()];
    },
    dispose() {
      for (const id of [...pending.keys()]) fail(id, "disposed");
    },
  };
}
