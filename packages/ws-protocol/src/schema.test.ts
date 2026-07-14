import { describe, it, expect } from "vitest";
import { decodeServer, encode } from "./index";

describe("show_list scheduledFor", () => {
  it("decodes a show_list entry carrying scheduledFor", () => {
    const raw = encode({
      type: "show_list",
      shows: [
        { id: "s1", name: "5/17/26", projectId: "p1", rowCount: 3, scheduledFor: "2026-05-17" },
      ],
    });
    const msg = decodeServer(raw);
    if (msg.type !== "show_list") throw new Error("wrong type");
    expect(msg.shows[0]!.scheduledFor).toBe("2026-05-17");
  });

  it("decodes a show_list entry without scheduledFor", () => {
    const raw = encode({
      type: "show_list",
      shows: [{ id: "s2", name: "Untitled", projectId: "p1", rowCount: 0 }],
    });
    const msg = decodeServer(raw);
    if (msg.type !== "show_list") throw new Error("wrong type");
    expect(msg.shows[0]!.scheduledFor).toBeUndefined();
  });
});
