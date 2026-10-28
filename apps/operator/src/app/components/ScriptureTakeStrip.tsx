"use client";

import type { ScriptureRow, Show } from "@overlaysys/core";
import { hasScriptureIntro } from "@overlaysys/core";
import { Button, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useScriptureSettings } from "@/lib/scriptureSettings";
import { useDialog } from "@/lib/dialog";

interface Props {
  show: Show;
  row: ScriptureRow;
  channel: string;
}

/**
 * Intro, Previous, Next and End scripture. Everything goes through the
 * server's scripture session, so Companion sees (and can continue) what's
 * pressed here. Per-slide jumps live in the thumbnail strip. On program every
 * button but End is an on-air action (D5).
 */
export function ScriptureTakeStrip({ show, row, channel }: Props) {
  const { send } = useWs();
  const { confirm, dialog } = useDialog();
  const settings = useScriptureSettings();
  const ch = useStore((s) => s.channelStates[channel]);
  const session = ch?.scriptureSession?.rowId === row.id ? ch.scriptureSession : null;
  const queued = ch?.queuedScripture?.rowId === row.id;
  const showIntro = settings ? hasScriptureIntro(row, settings) : false;
  const disconnected = useStore((s) => s.conn) !== "open";
  const variant = channel === "program" ? "onair" : "secondary";

  function next() {
    // Live: step on. Otherwise start at the first slide.
    if (session) send({ type: "scripture_advance", channel, delta: 1 });
    else send({ type: "scripture_take_slide", showId: show.id, rowId: row.id, slideIdx: 0, channel });
  }

  async function end() {
    const ok = await confirm({
      title: "End scripture?",
      message: `"${session?.reference ?? "This passage"}" will be cleared from ${channel}.`,
      confirmLabel: "End scripture",
      destructive: true,
    });
    if (ok) send({ type: "scripture_end", channel });
  }

  return (
    <div role="toolbar" aria-label="Scripture controls" style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
      {showIntro && (
        <Button
          size="md"
          variant={variant}
          aria-pressed={queued}
          disabled={disconnected}
          onClick={() => send({ type: "scripture_take_intro", showId: show.id, rowId: row.id, channel })}
          style={queued ? { boxShadow: `0 0 0 2px ${colors.text}` } : undefined}
        >
          Intro{queued ? " (queued)" : ""}
        </Button>
      )}
      <Button
        size="md"
        variant={variant}
        disabled={disconnected || !session || session.slideIdx <= 0}
        onClick={() => send({ type: "scripture_advance", channel, delta: -1 })}
      >
        Previous
      </Button>
      <Button
        size="md"
        variant={variant}
        disabled={disconnected || (!!session && session.slideIdx >= session.slideCount - 1)}
        onClick={next}
      >
        Next
      </Button>
      <Button size="md" variant="danger" disabled={disconnected || !session} onClick={end}>
        End scripture
      </Button>
      {dialog}
    </div>
  );
}
