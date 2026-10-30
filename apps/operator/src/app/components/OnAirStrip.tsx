"use client";

import { useEffect, useState } from "react";
import { Button, colors } from "@overlaysys/ui";
import { armConfirmPress } from "@/lib/armConfirm";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { channelHasContent, clearChannelMessages, pvwTakeMessages } from "@/lib/onAir";
import { useTakeFeedback } from "../hooks/useTakeFeedback";

/**
 * Air controls beside the monitors: Take (PVW to PGM), Clear PVW, Clear PGM
 * and Clear all, stacked full width. What each channel is showing is
 * captioned under its monitor (see MonitorCaption).
 */
export function AirControls() {
  const { send } = useWs();
  const channelStates = useStore((s) => s.channelStates);
  const show = useStore((s) => s.show);
  const disconnected = useStore((s) => s.conn) !== "open";
  const take = useTakeFeedback();
  // Clear all asks "Sure?" on the button itself: press again to clear.
  const [clearArmedUntil, setClearArmedUntil] = useState<number | null>(null);

  const pgm = channelStates["program"];
  const pvw = channelStates["preview"];
  const takeMsgs = pvwTakeMessages(pvw, show?.id ?? null);
  const anyContent = Object.values(channelStates).some(channelHasContent);
  const offline = disconnected ? "Disconnected from server" : undefined;

  function takePreview() {
    const [first, ...rest] = takeMsgs;
    if (!first) return;
    take.send(first);
    for (const m of rest) send(m);
  }

  function clearAll() {
    const live = Object.entries(channelStates).filter(([, st]) => channelHasContent(st));
    if (live.length === 0) return;
    const press = armConfirmPress(clearArmedUntil, Date.now());
    setClearArmedUntil(press.armedUntil);
    if (!press.fire) return;
    for (const [ch, st] of live) for (const m of clearChannelMessages(st, ch)) send(m);
  }
  const clearArmed = clearArmedUntil !== null;
  // Disarm when the window runs out, or when there's nothing left to clear.
  useEffect(() => {
    if (clearArmedUntil === null) return;
    if (!anyContent) {
      setClearArmedUntil(null);
      return;
    }
    const t = setTimeout(() => setClearArmedUntil(null), Math.max(0, clearArmedUntil - Date.now()));
    return () => clearTimeout(t);
  }, [clearArmedUntil, anyContent]);

  const blurAfter = (fn: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
    fn();
    e.currentTarget.blur();
  };
  const full = { width: "100%" } as const;

  return (
    <div role="region" aria-label="Air controls" style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <Button
        size="sm"
        onMouseDown={noFocus}
        variant="onair"
        style={full}
        disabled={disconnected || takeMsgs.length === 0 || take.status === "pending"}
        title={offline}
        aria-busy={take.status === "pending"}
        onClick={blurAfter(takePreview)}
      >
        {take.status === "pending" ? "Taking…" : "Take"}
      </Button>
      <Button
        size="sm"
        onMouseDown={noFocus}
        variant="secondary"
        style={full}
        disabled={disconnected || !channelHasContent(pvw)}
        title={offline}
        onClick={blurAfter(() => clearChannelMessages(pvw, "preview").forEach(send))}
      >
        Clear PVW
      </Button>
      <Button
        size="sm"
        onMouseDown={noFocus}
        variant="secondary"
        style={full}
        disabled={disconnected || !channelHasContent(pgm)}
        title={offline}
        onClick={blurAfter(() => clearChannelMessages(pgm, "program").forEach(send))}
      >
        Clear PGM
      </Button>
      <Button
        size="sm"
        onMouseDown={noFocus}
        variant="danger"
        style={full}
        disabled={disconnected || !anyContent}
        title={offline ?? (clearArmed ? "Press again to clear every channel" : "Clear every channel")}
        aria-live="polite"
        onClick={blurAfter(clearAll)}
      >
        {clearArmed ? "Sure? Clear all" : "Clear all"}
      </Button>
      {take.status === "failed" && (
        <span role="status" style={{ color: colors.warn, fontSize: 11 }}>
          No response; check program
        </span>
      )}
    </div>
  );
}

/** Keep focus off live controls after a click: Space is the global advance key. */
const noFocus = (e: React.MouseEvent) => e.preventDefault();
