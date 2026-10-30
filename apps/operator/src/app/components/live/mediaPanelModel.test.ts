import { describe, expect, it } from "vitest";
import type { ChannelState, MediaItemMeta } from "@overlaysys/core";
import { NO_FOLDER } from "../../media/libraryConfig";
import { filterPanelItems, mediaFolderTakeMessage, mediaItemTakeMessage, panelAirState } from "./mediaPanelModel";

const item = (over: Partial<MediaItemMeta> = {}): MediaItemMeta => ({
  id: "m1",
  name: "Welcome",
  kind: "file",
  mediaType: "image",
  assetUrl: "/assets/welcome.png",
  createdAt: "2026-10-30T00:00:00.000Z",
  usedBy: 0,
  ...over,
});

describe("mediaItemTakeMessage", () => {
  it("builds a photo take to preview and a video take to program with hold/sound defaults", () => {
    expect(mediaItemTakeMessage(item(), "preview")).toMatchObject({
      type: "media_take",
      channel: "preview",
      rowId: "media-item:m1",
      assetUrl: "/assets/welcome.png",
      label: "Welcome",
      mediaType: "image",
      fit: "cover",
      endAction: "hold",
    });
    const video = mediaItemTakeMessage(item({ id: "v1", name: "Countdown", mediaType: "video", assetUrl: "/assets/c.mp4" }), "program");
    expect(video).toMatchObject({
      type: "media_take",
      channel: "program",
      rowId: "media-item:v1",
      assetUrl: "/assets/c.mp4",
      mediaType: "video",
      endAction: "hold",
      volume: 1,
      muted: false,
      loop: false,
    });
    expect(video).not.toHaveProperty("showId");
  });
});

describe("mediaFolderTakeMessage", () => {
  it("asks the server to loop the folder on the channel", () => {
    expect(mediaFolderTakeMessage(item({ id: "lf1", kind: "live-folder", mediaType: undefined, assetUrl: undefined }), "program")).toEqual({
      type: "media_folder_take",
      id: "lf1",
      channel: "program",
    });
  });
});

describe("filterPanelItems", () => {
  const items = [
    item({ id: "a", name: "Welcome slide", folder: "Sunday" }),
    item({ id: "b", name: "Countdown", mediaType: "video", folder: "Sunday" }),
    item({ id: "c", name: "Baptism photos", kind: "live-folder", mediaType: undefined, assetUrl: undefined }),
    item({ id: "d", name: "Old welcome", deletedAt: "2026-10-01T00:00:00.000Z" }),
  ];
  const ids = (xs: MediaItemMeta[]) => xs.map((m) => m.id);

  it("filters by query and folder", () => {
    expect(ids(filterPanelItems(items, "", ""))).toEqual(["a", "b", "c"]);
    expect(ids(filterPanelItems(items, "  WELCOME ", ""))).toEqual(["a"]);
    expect(ids(filterPanelItems(items, "", "Sunday"))).toEqual(["a", "b"]);
    expect(ids(filterPanelItems(items, "count", "Sunday"))).toEqual(["b"]);
    expect(ids(filterPanelItems(items, "", NO_FOLDER))).toEqual(["c"]);
    expect(ids(filterPanelItems(items, "", "all"))).toEqual(["a", "b", "c"]);
  });
});

describe("panelAirState", () => {
  const st = (rowId: string): ChannelState => ({ channel: "x", active: null, media: { rowId } } as unknown as ChannelState);

  it("lights an item or folder taken from the panel", () => {
    const states = { program: st("media-item:a"), preview: st("media-folder:c") };
    expect(panelAirState(item({ id: "a" }), states)).toBe("program");
    expect(panelAirState(item({ id: "c", kind: "live-folder" }), states)).toBe("preview");
    expect(panelAirState(item({ id: "b" }), states)).toBeNull();
  });
});
