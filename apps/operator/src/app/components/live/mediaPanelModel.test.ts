import { describe, expect, it } from "vitest";
import type { ChannelState, MediaItemMeta } from "@overlaysys/core";
import { NO_FOLDER } from "../../media/libraryConfig";
import {
  dblClickFromControl,
  filterPanelItems,
  mediaFolderTakeMessage,
  mediaItemTakeMessage,
  panelAirState,
  panelPlacement,
  panelPlacementState,
  panelPlacementShown,
  searchKeyReleasesFocus,
  shouldReleaseFocus,
} from "./mediaPanelModel";

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
  it("takes an item with its own size and position", () => {
    expect(mediaItemTakeMessage(item({ fit: "scale-down", position: "bottom" }), "program")).toMatchObject({
      fit: "scale-down",
      position: "bottom",
    });
    expect(mediaItemTakeMessage(item(), "program")).not.toHaveProperty("position");
  });

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

describe("focus hand-back", () => {
  const search = { id: "search" };
  const outside = { id: "outside" };
  const panel = { contains: (n: unknown) => n === search };

  it("a Cue/Take releases focus held by the panel's search or folder box, nothing else", () => {
    expect(shouldReleaseFocus(search, panel)).toBe(true);
    expect(shouldReleaseFocus(outside, panel)).toBe(false);
    expect(shouldReleaseFocus(null, panel)).toBe(false);
    expect(shouldReleaseFocus(search, null)).toBe(false);
  });

  it("Escape and Enter in the search box hand the keyboard back", () => {
    expect(searchKeyReleasesFocus("Escape")).toBe(true);
    expect(searchKeyReleasesFocus("Enter")).toBe(true);
    expect(searchKeyReleasesFocus(" ")).toBe(false);
    expect(searchKeyReleasesFocus("a")).toBe(false);
  });
});

describe("dblClickFromControl", () => {
  const el = (inButton: boolean) => ({ closest: (sel: string) => (sel === "button, select, [data-no-card-dblclick]" && inButton ? {} : null) });

  it("a double-click on Cue or Take is not a card double-click", () => {
    expect(dblClickFromControl(el(true))).toBe(true);
    expect(dblClickFromControl(el(false))).toBe(false);
    expect(dblClickFromControl(null)).toBe(false);
    expect(dblClickFromControl({})).toBe(false);
  });
});

describe("panel placement", () => {
  it("a chosen size and position win over the item's own, for this take only", () => {
    const it = item({ fit: "scale-down", position: "bottom" });
    expect(mediaItemTakeMessage(it, "program", { fit: "fill", position: "top-left" })).toMatchObject({ fit: "fill", position: "top-left" });
    expect(mediaItemTakeMessage(it, "program", { position: "right" })).toMatchObject({ fit: "scale-down", position: "right" });
    expect(mediaItemTakeMessage(it, "program")).toMatchObject({ fit: "scale-down", position: "bottom" });
    expect(it).toMatchObject({ fit: "scale-down", position: "bottom" });
  });

  it("a live folder take carries only what was chosen, so the deck default applies otherwise", () => {
    expect(mediaFolderTakeMessage({ id: "lf1" }, "program")).toEqual({ type: "media_folder_take", id: "lf1", channel: "program" });
    expect(mediaFolderTakeMessage({ id: "lf1" }, "program", { fit: "contain" })).toEqual({
      type: "media_folder_take", id: "lf1", channel: "program", fit: "contain",
    });
  });

  it("shows the item's own placement until something is chosen", () => {
    expect(panelPlacementShown(item({ fit: "fill" }), {})).toEqual({ fit: "fill", position: "center" });
    expect(panelPlacementShown(item({ mediaType: "video" }), {})).toEqual({ fit: "contain", position: "center" });
    // A live folder follows its deck until the operator picks.
    const lf = item({ kind: "live-folder", mediaType: undefined });
    expect(panelPlacementShown(lf, {})).toEqual({ fit: null, position: null });
    expect(panelPlacementShown(lf, { position: "top" })).toEqual({ fit: null, position: "top" });
    expect(panelPlacementShown(lf, { fit: "cover", position: "center" })).toEqual({ fit: "cover", position: "center" });
  });

  it("choices reset to the item default when the item changes", () => {
    const a = item({ id: "a" });
    const chosen = { fit: "fill" as const };
    const s1 = panelPlacementState(a, chosen);
    expect(panelPlacement(s1, a)).toEqual(chosen);
    expect(panelPlacement(s1, item({ id: "b" }))).toEqual({});
    expect(panelPlacement(s1, item({ id: "a", fit: "contain" }))).toEqual({});
  });
});
