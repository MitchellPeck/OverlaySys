/**
 * Per-frame paint loop. In `static` mode paint() runs once per start()/paintNow()
 * call and no rAF callback is ever scheduled (thumbnails parked on a pose).
 */
export interface Ticker {
  start(): void;
  /** Paint now, without scheduling. */
  paintNow(): void;
  stop(): void;
}

export function createTicker(
  paint: () => void,
  opts: {
    static?: boolean;
    raf?: (cb: () => void) => number;
    caf?: (id: number) => void;
  } = {},
): Ticker {
  const raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = opts.caf ?? ((id) => cancelAnimationFrame(id));
  let id: number | null = null;
  function loop(): void {
    paint();
    id = raf(loop);
  }
  return {
    start() {
      if (opts.static) {
        paint();
        return;
      }
      if (id != null) return;
      loop();
    },
    paintNow: paint,
    stop() {
      if (id != null) {
        caf(id);
        id = null;
      }
    },
  };
}
