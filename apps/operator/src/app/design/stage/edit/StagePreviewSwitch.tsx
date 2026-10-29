"use client";

import { Select, Switch, confirm } from "@overlaysys/ui";
import { previewNeedsConfirm } from "@/lib/stageDesigner";

type Props = {
  channels: { id: string; name: string }[];
  channelId: string;
  onChannel(id: string): void;
  on: boolean;
  onChange(on: boolean): void;
  disabled: boolean;
  showLive: boolean;
  channelInUse: boolean;
};

/** "Show on <stage monitor>": off by default; asks first when it would replace a live monitor. */
export function StagePreviewSwitch({ channels, channelId, onChannel, on, onChange, disabled, showLive, channelInUse }: Props) {
  const channelName = channels.find((c) => c.id === channelId)?.name ?? "stage monitor";

  async function toggle(next: boolean) {
    if (next && previewNeedsConfirm({ showLive, channelInUse })) {
      const ok = await confirm({
        title: "Show this draft on the stage monitor?",
        message: `${channelName} is in use during a live show. The pastor will see this draft layout until you turn it off.`,
        confirmLabel: "Show draft",
      });
      if (!ok) return;
    }
    onChange(next);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
      {channels.length > 1 && (
        <div style={{ width: 140 }}>
          <Select aria-label="Stage monitor" value={channelId} onChange={(e) => onChannel(e.target.value)}>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      <Switch checked={on} disabled={disabled} label={`Show on ${channelName}`} onChange={(v) => void toggle(v)} />
    </div>
  );
}
