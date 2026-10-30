"use client";

import { useEffect, useState } from "react";
import type { MediaItem } from "@overlaysys/core";
import { Button, Dialog, Input, Tooltip, colors, fontSize, radius } from "@overlaysys/ui";
import { useStore } from "../../lib/store";
import { getDesktopApi } from "../../lib/desktop";
import { deleteMediaItem, displayServerError, requestLiveFolder, saveMediaItem, setLiveFolderPath } from "../../lib/mediaRequests";
import { newMediaId } from "./importMedia";
import { liveFolderCountText } from "./libraryConfig";

const NOT_DESKTOP = "Choose the folder on the show computer";
/** Files appear after a few seconds of being unchanged, so keep asking while the dialog is open. */
const REFRESH_MS = 4000;

/**
 * Add a live folder (name it, choose the folder) or, with `existing`, change which
 * folder it points at. The folder path stays on this computer; only the name is saved.
 */
export function LiveFolderDialog({
  open,
  onClose,
  existing,
  folder,
  onError,
}: {
  open: boolean;
  onClose(): void;
  existing?: MediaItem;
  /** Operator folder to file a new live folder under. */
  folder?: string;
  onError(message: string): void;
}) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [id, setId] = useState<string>("");
  const [created, setCreated] = useState(false);
  const [busy, setBusy] = useState(false);
  const pick = getDesktopApi()?.pickFolder;
  const files = useStore((s) => s.liveFolderFiles[id]);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? "");
    setPicked(null);
    setId(existing?.id ?? newMediaId());
    setCreated(!!existing);
    setBusy(false);
    // Only reset when the dialog opens or targets another folder; store updates must not wipe the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id]);

  const watching = open && created && !!id;
  useEffect(() => {
    if (!watching) return;
    requestLiveFolder(id);
    const t = setInterval(() => requestLiveFolder(id), REFRESH_MS);
    return () => clearInterval(t);
  }, [watching, id]);

  const choose = async () => {
    const path = await getDesktopApi()?.pickFolder?.();
    if (!path) return;
    if (!existing) {
      setPicked(path);
      return;
    }
    try {
      await setLiveFolderPath(id, path);
      requestLiveFolder(id);
    } catch (e) {
      onError(displayServerError(e));
    }
  };

  const blocker = created ? null : !name.trim() ? "Name the live folder" : !picked ? "Choose the folder" : null;

  const add = async () => {
    if (blocker || !picked || busy) return;
    setBusy(true);
    try {
      await saveMediaItem({
        id,
        name: name.trim(),
        kind: "live-folder",
        ...(folder ? { folder } : {}),
        createdAt: new Date().toISOString(),
      });
      try {
        await setLiveFolderPath(id, picked);
      } catch (e) {
        // Don't leave a live folder that points nowhere.
        await deleteMediaItem(id).catch(() => {});
        throw e;
      }
      setCreated(true);
    } catch (e) {
      onError(displayServerError(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseButton = (
    <Button variant="secondary" size="md" disabled={!pick} onClick={() => void choose()} style={!pick ? { pointerEvents: "none" } : undefined}>
      {existing || picked ? "Change folder…" : "Choose folder…"}
    </Button>
  );
  const addButton = (
    <Button variant="primary" size="md" disabled={!!blocker || busy} onClick={() => void add()} style={blocker ? { pointerEvents: "none" } : undefined}>
      {busy ? "Adding…" : "Add live folder"}
    </Button>
  );
  const wrap = (reason: string | null, node: React.ReactNode) =>
    reason ? (
      <Tooltip content={reason} side="top">
        <span tabIndex={0} style={{ display: "inline-flex", borderRadius: radius.md, outline: "none" }}>
          {node}
        </span>
      </Tooltip>
    ) : (
      node
    );

  const count = files && files.configured ? liveFolderCountText(files.files.length) : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={existing ? "Live folder" : "Add live folder"}
      size="sm"
      onConfirm={created ? onClose : () => void add()}
      footer={
        created ? (
          <Button variant="primary" size="md" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="md" onClick={onClose}>
              Cancel
            </Button>
            {wrap(blocker, addButton)}
          </>
        )
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ margin: 0, fontSize: fontSize.sm, color: colors.textDim }}>
          A live folder plays whatever photos and videos are in a folder on the show computer. New files appear a few seconds after they finish copying.
        </p>
        {!existing && !created && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor="live-folder-name" style={{ fontSize: fontSize.sm, color: colors.textDim }}>
              Name
            </label>
            <Input id="live-folder-name" size="md" autoFocus value={name} placeholder="Live folder name" onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {wrap(pick ? null : NOT_DESKTOP, chooseButton)}
          {picked && !created && (
            <span style={{ fontSize: fontSize.sm, color: colors.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }} title={picked}>
              {picked}
            </span>
          )}
        </div>
        {created && (
          <div style={{ fontSize: fontSize.sm, color: colors.text }}>
            {count ?? (files?.configured === false ? "No folder chosen yet" : "Looking for photos and videos…")}
          </div>
        )}
      </div>
    </Dialog>
  );
}
