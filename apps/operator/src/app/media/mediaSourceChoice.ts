import { importErrorText } from "./libraryConfig";
import { importMediaFile, mediaTypeOf, type ImportDeps } from "./importMedia";
import { pickFromItem, type PickAccept, type PickedMedia } from "./pickerModel";

/**
 * The one rule set for every place a photo or video is chosen: "Choose from
 * Media" (show computer only) and "Upload" (which adds the file to Media
 * first, then uses it).
 */
export type SourceAction = "library" | "upload";

/** A pick or upload for a row's source; uploads carry the duration read while importing. */
export type SourcePick = PickedMedia & { durationSec?: number };

/** Media lives on the show computer, so cloud mode offers Upload only. */
export function sourceActions(cloud: boolean): SourceAction[] {
  return cloud ? ["upload"] : ["library", "upload"];
}

/** The URL a plain-string field stores for a pick; null when cancelled or the item is the wrong type. */
export function urlFromPick(pick: PickedMedia | null, accept: PickAccept): { url: string } | null {
  if (!pick || !pick.assetUrl) return null;
  if (accept !== "any" && pick.mediaType !== accept) return null;
  return { url: pick.assetUrl };
}

/** Why a file can't be used for `accept`, in plain words; null when it can. */
export function uploadRefusal(mime: string, accept: PickAccept): string | null {
  const type = mediaTypeOf(mime);
  if (type && (accept === "any" || type === accept)) return null;
  return accept === "video" ? "Choose a video file." : accept === "image" ? "Choose a photo." : "Choose a photo or video.";
}

export type SourceUploadDeps = ImportDeps & { cloud: boolean };

/**
 * Upload a photo or video for a source. On the show computer it joins Media and
 * the pick links to the new item; in cloud mode it's a plain upload.
 * Throws the refusal sentence for the wrong kind of file.
 */
export async function uploadMediaSource(file: File, accept: PickAccept, deps: SourceUploadDeps): Promise<SourcePick> {
  const refusal = uploadRefusal(file.type, accept);
  if (refusal) throw new Error(refusal);
  if (deps.cloud) {
    const up = await deps.upload(file);
    const mediaType = mediaTypeOf(up.mime) ?? mediaTypeOf(file.type);
    if (!mediaType) throw new Error("That file isn't a photo or video.");
    return { assetUrl: up.url, mediaType, name: file.name };
  }
  const item = await importMediaFile(file, deps);
  return { ...pickFromItem(item), ...(item.durationSec ? { durationSec: item.durationSec } : {}) };
}

/** Upload for a plain-string field (template data, layer src): the stored URL, or a plain-language error. */
export async function uploadFieldFile(file: File, accept: PickAccept, deps: SourceUploadDeps): Promise<string> {
  const refusal = uploadRefusal(file.type, accept);
  if (refusal) throw new Error(refusal);
  try {
    return (await uploadMediaSource(file, accept, deps)).assetUrl;
  } catch (e) {
    throw new Error(`Couldn't upload ${file.name}: ${importErrorText(e)}`);
  }
}

/**
 * The designer's one upload path, shared by image/video sources and fonts:
 * photos and videos join Media; anything else (fonts) uploads as before.
 */
export async function uploadAnyFile(file: File, deps: SourceUploadDeps): Promise<string> {
  if (mediaTypeOf(file.type)) return uploadFieldFile(file, "any", deps);
  return (await deps.upload(file)).url;
}
