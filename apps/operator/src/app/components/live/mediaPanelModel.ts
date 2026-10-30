import { resolveMediaPlacement, type ChannelState, type MediaItemMeta, type MediaPlacement, type PartialMediaPlacement } from "@overlaysys/core";
import { mediaRowTakeMessage, type ClientMessage } from "@overlaysys/ws-protocol";
import { NO_FOLDER } from "../../media/libraryConfig";
import { newMediaRowFromPick } from "../../media/pickerModel";
import { ownPlacement } from "../../../lib/mediaPlacement";

export type PanelChannel = "preview" | "program";

/** Row ids the panel's takes carry, so the panel can light what it put on air. */
export const panelRowId = (m: Pick<MediaItemMeta, "id" | "kind">): string =>
  m.kind === "live-folder" ? `media-folder:${m.id}` : `media-item:${m.id}`;

/**
 * The `media_take` for a library file, with a Media row's defaults: a photo
 * covers the frame and holds; a video plays once with sound and holds its last
 * frame. The item's own size/position go with it. No show id, so nothing in
 * the show changes.
 */
export function mediaItemTakeMessage(item: MediaItemMeta, channel: PanelChannel, placement?: PartialMediaPlacement): ClientMessage {
  const row = newMediaRowFromPick(
    { mediaItemId: item.id, assetUrl: item.assetUrl ?? "", mediaType: item.mediaType ?? "image", ...ownPlacement(item), ...ownPlacement(placement) },
    panelRowId(item),
  );
  const labelled = { ...row, label: item.name };
  return mediaRowTakeMessage(labelled.kind === "video" ? { ...labelled, loop: false, muted: false } : labelled, channel);
}

/**
 * A live folder loops on the server (8 s hold); the server refuses an empty one.
 * Only what was chosen goes along; the rest follows the linked deck.
 */
export function mediaFolderTakeMessage(
  item: Pick<MediaItemMeta, "id">,
  channel: PanelChannel,
  placement?: PartialMediaPlacement,
): ClientMessage {
  return { type: "media_folder_take", id: item.id, channel, ...ownPlacement(placement) };
}

/** A card's size/position choices, tagged with the item (and its own placement) they were made for. */
export type PanelPlacementState = { itemKey: string; chosen: PartialMediaPlacement };

const placementKey = (item: Pick<MediaItemMeta, "id" | "fit" | "position">): string =>
  `${item.id}|${item.fit ?? ""}|${item.position ?? ""}`;

export const panelPlacementState = (item: Pick<MediaItemMeta, "id" | "fit" | "position">, chosen: PartialMediaPlacement): PanelPlacementState => ({
  itemKey: placementKey(item),
  chosen,
});

/** The choices that still apply: none once the item (or its own size/position) is no longer the one they were made for. */
export function panelPlacement(
  state: PanelPlacementState,
  item: Pick<MediaItemMeta, "id" | "fit" | "position">,
): PartialMediaPlacement {
  return state.itemKey === placementKey(item) ? state.chosen : {};
}

/** What the controls show: the choice, else the item's own, else what plays today (Fill screen / centre for a photo or folder). */
export function panelPlacementShown(
  item: Pick<MediaItemMeta, "kind" | "mediaType" | "fit" | "position">,
  chosen: PartialMediaPlacement,
): MediaPlacement {
  return resolveMediaPlacement(item.kind !== "live-folder" && item.mediaType === "video" ? "video" : "image", chosen, item);
}

/**
 * Items the panel offers: photos, videos and live folders (not deleted),
 * matching `query` by name and `folder` ("" or "all" = any; NO_FOLDER = none).
 */
export function filterPanelItems<T extends MediaItemMeta>(items: T[], query: string, folder: string): T[] {
  const q = query.trim().toLowerCase();
  return items.filter(
    (m) =>
      !m.deletedAt &&
      (m.kind === "live-folder" || (!!m.assetUrl && !!m.mediaType)) &&
      (!q || m.name.toLowerCase().includes(q)) &&
      (!folder || folder === "all" || (folder === NO_FOLDER ? !m.folder : m.folder === folder)),
  );
}

/** "program" / "preview" when the panel's take of this item is in that channel's media slot. */
export function panelAirState(
  item: Pick<MediaItemMeta, "id" | "kind">,
  channelStates: Record<string, ChannelState | undefined>,
): PanelChannel | null {
  const rowId = panelRowId(item);
  if (channelStates["program"]?.media?.rowId === rowId) return "program";
  if (channelStates["preview"]?.media?.rowId === rowId) return "preview";
  return null;
}

/**
 * Cue/Take hand the keyboard back to the show shortcuts: true when focus sits
 * in the panel (its search or folder box), where Space/Enter would type or
 * pick instead of driving the show.
 */
export function shouldReleaseFocus<T>(active: T | null, panel: { contains(node: T): boolean } | null): boolean {
  return !!active && !!panel && panel.contains(active);
}

/** Keys in the search box that hand the keyboard back to the show. */
export const searchKeyReleasesFocus = (key: string): boolean => key === "Escape" || key === "Enter";

/** A double-click that landed on Cue, Take or a size/position control: never a card double-click (which may take to program). */
export function dblClickFromButton(target: { closest?(selector: string): unknown } | null): boolean {
  return !!target?.closest?.("button, select");
}
