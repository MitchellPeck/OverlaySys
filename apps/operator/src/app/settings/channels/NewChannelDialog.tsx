"use client";

import { useState } from "react";
import { DEFAULT_STAGE_FOLLOWS } from "@overlaysys/core";
import type { ChannelConfig, ChannelKind, ChannelRenderMode, StageLayoutMeta } from "@overlaysys/core";
import { Button, Dialog, Field, Input, SegmentedControl, Select } from "@overlaysys/ui";
import { layoutPickerModel } from "@/lib/stageLayoutPicker";
import { channelIdFromName, newChannelDefaults } from "./channelDraft";

export function NewChannelDialog({
  open,
  channels,
  stageLayouts,
  disabledReason,
  onClose,
  onCreate,
}: {
  open: boolean;
  channels: ChannelConfig[];
  stageLayouts: StageLayoutMeta[];
  disabledReason?: string;
  onClose: () => void;
  onCreate: (config: ChannelConfig) => Promise<void>;
}) {
  const [kind, setKind] = useState<ChannelKind>("graphics");
  const [name, setName] = useState("");
  const [follows, setFollows] = useState(DEFAULT_STAGE_FOLLOWS);
  const [layoutId, setLayoutId] = useState("speaker");
  const [renderMode, setRenderMode] = useState<ChannelRenderMode>("normal");
  const [mirrorOf, setMirrorOf] = useState("");
  const [busy, setBusy] = useState(false);

  const followOptions = channels.filter((c) => c.kind !== "stage");
  const layoutModel = layoutPickerModel(stageLayouts, layoutId);
  const canCreate = name.trim().length > 0 && !busy && !disabledReason;

  async function create() {
    if (!canCreate) return;
    const id = channelIdFromName(name, channels.map((c) => c.id));
    const defaults = newChannelDefaults(kind);
    const config = {
      id,
      name: name.trim(),
      background: "transparent",
      renderMode: "normal",
      ...defaults,
      ...(kind === "stage" ? { follows, layoutId } : { renderMode, ...(mirrorOf ? { mirrorOf } : {}) }),
    } as ChannelConfig;
    setBusy(true);
    try {
      await onCreate(config);
      setName("");
      setMirrorOf("");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New channel"
      size="sm"
      onConfirm={() => void create()}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canCreate} title={disabledReason} onClick={() => void create()}>
            Create
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Kind">
          <SegmentedControl<ChannelKind>
            aria-label="Channel kind"
            value={kind}
            onChange={setKind}
            options={[
              { value: "graphics", label: "Graphics output" },
              { value: "stage", label: "Stage monitor" },
            ]}
          />
        </Field>
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "stage" ? "Green room" : "Lower thirds key"} />
        </Field>
        {kind === "stage" ? (
          <>
            <Field label="Shows content from">
              <Select value={follows} onChange={(e) => setFollows(e.target.value)}>
                {!followOptions.some((o) => o.id === follows) && <option value={follows}>{follows}</option>}
                {followOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Layout">
              <Select value={layoutModel.value} onChange={(e) => setLayoutId(e.target.value)}>
                {layoutModel.options.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : (
          <>
            <Field label="Render mode">
              <Select value={renderMode} onChange={(e) => setRenderMode(e.target.value as ChannelRenderMode)}>
                <option value="normal">Normal</option>
                <option value="matte">Matte (white on black)</option>
              </Select>
            </Field>
            <Field label="Mirror">
              <Select value={mirrorOf} onChange={(e) => setMirrorOf(e.target.value)}>
                <option value="">No mirror</option>
                {channels.map((o) => (
                  <option key={o.id} value={o.id}>
                    Mirrors {o.name}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
