import { describe, expect, it } from "vitest";

import { useWs } from "./useWs";

/**
 * `send`'s identity is a correctness concern, not a style one.
 *
 * Every data-fetching effect in the operator lists it in its dependency
 * array (`useEffect(..., [conn, send])`). If useWs hands back a fresh
 * closure per call, those effects re-run on every render — and since the
 * effect's own responses land in the store, the store update re-renders the
 * component, which produces yet another `send`, which re-fires the effect.
 *
 * On the STT page that feedback loop froze the renderer and flooded the
 * server: each iteration re-read data/stt/config.json, holding thousands of
 * concurrent file descriptors until the server hit its fd ceiling and
 * spawn("bash", …) failed with EBADF — i.e. STT would never start.
 */
describe("useWs", () => {
  it("returns a stable send across calls so effects don't self-retrigger", () => {
    expect(useWs().send).toBe(useWs().send);
  });

  it("returns a stable handle object across calls", () => {
    expect(useWs()).toBe(useWs());
  });
});
