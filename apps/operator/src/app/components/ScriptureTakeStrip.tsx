"use client";

import type { ScriptureRow, Show } from "@overlaysys/core";
import { hasScriptureIntro } from "@overlaysys/core";
import { Button, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useScriptureSettings } from "@/lib/scriptureSettings";

/** Keep focus off clicked buttons so Space stays the global advance key. */
const keep = (e: React.MouseEvent) => e.preventDefault();

interface Props {
  show: Show;
  row: ScriptureRow;
  channel: string;
  /** Asked before starting the scripture on air (e.g. its design has no layers); false cancels. */
  confirmStart?: () => Promise<boolean>;
}

/**
 * Intro, Previous, Next and End scripture. Everything goes through the
 * server's scripture session, so Companion sees (and can continue) what's
 * pressed here. Per-slide jumps live in the thumbnail strip. On program every
 * button but End is an on-air action (D5).
 */
export function ScriptureTakeStrip({ show, row, channel, confirmStart }: Props) {
  const { send } = useWs();
  const settings = useScriptureSettings();
  const ch = useStore((s) => s.channelStates[channel]);
  const session = ch?.scriptureSession?.rowId === row.id ? ch.scriptureSession : null;
  const queued = ch?.queuedScripture?.rowId === row.id;
  const showIntro = settings ? hasScriptureIntro(row, settings) : false;
  const disconnected = useStore((s) => s.conn) !== "open";
  const variant = channel === "program" ? "onair" : "secondary";

  async function next() {
    // Live: step on. Otherwise start at the first slide.
    if (session) {
      send({ type: "scripture_advance", channel, delta: 1 });
      return;
    }
    if (confirmStart && channel !== "preview" && !(await confirmStart())) return;
    send({ type: "scripture_take_slide", showId: show.id, rowId: row.id, slideIdx: 0, channel });
  }

  return (
    <div role="toolbar" aria-label="Scripture controls" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {showIntro && (
        <Button
          size="md"
          onMouseDown={keep}
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
        onMouseDown={keep}
        variant={variant}
        disabled={disconnected || !session || session.slideIdx <= 0}
        onClick={() => send({ type: "scripture_advance", channel, delta: -1 })}
      >
        Previous
      </Button>
      <Button
        size="md"
        onMouseDown={keep}
        variant={variant}
        disabled={disconnected || (!!session && session.slideIdx >= session.slideCount - 1)}
        onClick={() => void next()}
      >
        Next
      </Button>
      <Button size="md" variant="danger" onMouseDown={keep} disabled={disconnected || !session} onClick={() => send({ type: "scripture_end", channel })}>
        End scripture
      </Button>
    </div>
  );
}
