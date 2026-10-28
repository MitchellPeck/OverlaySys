import { expect, it } from "vitest";
import { offlineCopy } from "./offlineCopy";

it("empty with noun", () => {
  expect(offlineCopy("songs", "empty")).toEqual({ title: "Can't load songs", body: "Not connected to the server." });
});
it("empty without noun", () => {
  expect(offlineCopy()).toEqual({ title: "Not connected to the server", body: "Retrying automatically." });
});
it("stale", () => {
  expect(offlineCopy(undefined, "stale")).toEqual({ title: "Not connected to the server", body: "Showing what was last loaded." });
  expect(offlineCopy("songs", "stale").body).toBe("Showing what was last loaded.");
});
