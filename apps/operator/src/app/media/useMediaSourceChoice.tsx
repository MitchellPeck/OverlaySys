"use client";

import { useCallback, useMemo } from "react";
import { isCloudMode } from "../../lib/mode";
import { sourceUploadDeps, useLibraryPicker } from "./MediaPicker";
import { sourceActions, uploadAnyFile, uploadFieldFile, urlFromPick } from "./mediaSourceChoice";

type Kind = "image" | "video";

/**
 * "Choose from Media" and "Upload" for an editor-kit ImageInput / VideoInput
 * (template fields, designer layers and field defaults). Values stay the asset
 * URL string; uploads join Media first. In cloud mode `pickFromLibrary` is
 * undefined (the button is hidden) and Upload is a plain upload.
 * Render `picker` once beside the inputs.
 */
export function useMediaSourceChoice(): {
  pickFromLibrary: ((kind: Kind) => Promise<{ url: string } | null>) | undefined;
  /** Upload for a field of a known kind; refuses the other kind in plain words. */
  uploadFor: (kind: Kind) => (file: File) => Promise<string>;
  /** Upload for an input shared with fonts (the designer): photos/videos join Media, anything else uploads as before. */
  uploadAny: (file: File) => Promise<string>;
  picker: React.ReactNode;
} {
  const library = useLibraryPicker();
  const canChoose = sourceActions(isCloudMode()).includes("library");
  const { pick } = library;
  const pickFromLibrary = useMemo(
    () => (canChoose ? async (kind: Kind) => urlFromPick(await pick(kind), kind) : undefined),
    [canChoose, pick],
  );
  const uploadFor = useCallback((kind: Kind) => (file: File) => uploadFieldFile(file, kind, sourceUploadDeps()), []);
  const uploadAny = useCallback((file: File) => uploadAnyFile(file, sourceUploadDeps()), []);
  return { pickFromLibrary, uploadFor, uploadAny, picker: library.picker };
}
