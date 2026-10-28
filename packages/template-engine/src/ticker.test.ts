import { describe, expect, it } from "vitest";
import { createTicker } from "./ticker";

describe("createTicker", () => {
  it("static mode paints but never schedules a frame", () => {
    let painted = 0;
    let scheduled = 0;
    const t = createTicker(() => painted++, {
      static: true,
      raf: () => ++scheduled,
      caf: () => {},
    });
    t.start();
    t.paintNow();
    expect(painted).toBe(2);
    expect(scheduled).toBe(0);
  });

  it("live mode keeps scheduling until stopped", () => {
    let scheduled = 0;
    const t = createTicker(() => {}, { raf: () => ++scheduled, caf: () => {} });
    t.start();
    expect(scheduled).toBe(1);
    t.stop();
  });
});
