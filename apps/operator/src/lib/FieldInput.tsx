"use client";

import { ColorInput, ImageInput, VideoInput } from "@overlaysys/editor-kit";
import { Input } from "@overlaysys/ui";
import type { Field } from "@overlaysys/core";
import { uploadAsset, resolveAssetUrl } from "./uploadAsset";

type Props = {
  field: Field;
  value: string | undefined;
  onChange: (v: string) => void;
};

const upload = async (file: File): Promise<string> => (await uploadAsset(file)).url;

/**
 * Renders the right input control for a Field's declared type. Used by both
 * the show rundown editor and the operator's manual TakePanel so the input
 * stays consistent everywhere a row's data is edited.
 */
export function FieldInput({ field, value, onChange }: Props) {
  const v = value ?? field.default ?? "";
  switch (field.type) {
    case "color":
      return <ColorInput value={v || "#ffffff"} onChange={onChange} />;
    case "image":
      // Resolve `/assets/...` paths against the WS server's HTTP origin so
      // the editor's `<img>` preview loads in dev mode (operator @ :3000,
      // server @ :4000). In Electron production the operator is served by
      // the asset server itself so this is a no-op.
      return <ImageInput value={resolveAssetUrl(v)} onChange={onChange} onUpload={upload} />;
    case "video":
      return <VideoInput value={resolveAssetUrl(v)} onChange={onChange} onUpload={upload} />;
    case "number":
      return (
        <Input
          type="number"
          value={value ?? field.default ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.default ?? ""}
        />
      );
    case "text":
    default:
      return (
        <Input
          value={value ?? field.default ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.default ?? ""}
        />
      );
  }
}
