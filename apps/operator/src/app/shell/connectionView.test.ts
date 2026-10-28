import { describe, expect, it } from "vitest";
import { connectionView } from "./connectionView";
import { DISCONNECTED_GRACE_MS } from "./shellStatus";

describe("connectionView", () => {
  it("hides when open", () => {
    expect(connectionView("open", 0, 99999).show).toBe(false);
  });
  it("hides within the grace period", () => {
    expect(connectionView("closed", 0, DISCONNECTED_GRACE_MS - 1).show).toBe(false);
  });
  it("shows past grace when closed", () => {
    expect(connectionView("closed", 0, DISCONNECTED_GRACE_MS + 1)).toEqual({
      show: true,
      title: "Can't reach the OverlaySys server. Takes are not being sent.",
      detail: "Retrying automatically.",
    });
  });
  it("says Reconnecting while connecting", () => {
    expect(connectionView("connecting", 0, DISCONNECTED_GRACE_MS + 1).detail).toBe("Reconnecting…");
  });
});
