import { beforeEach, describe, expect, it, vi } from "vitest";
import * as outputs from "./outputs";
import { sweep, trackSocket, type PingableSocket } from "./heartbeat";

describe("outputs", () => {
  beforeEach(() => outputs._resetForTest());

  it("counts renderer sockets per channel with labels", () => {
    outputs.addOutput("c1", "program", "OBS", 100);
    outputs.addOutput("c2", "program", "Desktop window", 200);
    outputs.addOutput("c3", "alpha", "OBS", 150);
    expect(outputs.outputsSnapshot()).toEqual({
      program: { count: 2, lastSeen: 200, labels: ["OBS", "Desktop window"] },
      alpha: { count: 1, lastSeen: 150, labels: ["OBS"] },
    });
  });

  it("notifies on add/remove but not on a repeat subscribe or a touch", () => {
    const fn = vi.fn();
    outputs.subscribeOutputs(fn);
    outputs.addOutput("c1", "program", "OBS");
    outputs.addOutput("c1", "program", "OBS");
    outputs.touchOutput("c1");
    expect(fn).toHaveBeenCalledTimes(1);
    outputs.removeConnection("c1");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(outputs.outputCount("program")).toBe(0);
    outputs.removeConnection("c1");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("touch moves lastSeen", () => {
    outputs.addOutput("c1", "program", "OBS", 100);
    outputs.touchOutput("c1", 900);
    expect(outputs.outputsSnapshot()["program"]?.lastSeen).toBe(900);
  });
});

describe("heartbeat sweep", () => {
  class Sock implements PingableSocket {
    pings = 0;
    terminated = false;
    private pong: (() => void) | null = null;
    ping() {
      this.pings++;
    }
    terminate() {
      this.terminated = true;
    }
    on(_e: "pong", l: () => void) {
      this.pong = l;
      return this;
    }
    answer() {
      this.pong?.();
    }
  }

  it("terminates a socket after two missed pongs", () => {
    const dead = new Sock();
    const alive = new Sock();
    trackSocket(dead);
    trackSocket(alive);
    for (let i = 0; i < 3; i++) {
      sweep([dead, alive]);
      alive.answer();
    }
    expect(dead.terminated).toBe(true);
    expect(dead.pings).toBe(2);
    expect(alive.terminated).toBe(false);
    expect(alive.pings).toBe(3);
  });
});
