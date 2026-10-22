"use client";

import type { ScriptureRow, Show } from "@overlaysys/core";
import { hasScriptureIntro } from "@overlaysys/core";
import { slideReference } from "@overlaysys/scripture";
import { Button, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useScriptureSettings } from "@/lib/scriptureSettings";

interface Props {
  show: Show;
  row: ScriptureRow;
  channel: string;
}

/**
 * Intro + one button per slide. Everything goes through the server's
 * scripture session, so Companion sees (and can continue) what's pressed here.
 */
export function ScriptureTakeStrip({ show, row, channel }: Props) {
  const { send } = useWs();
  const settings = useScriptureSettings();
  const ch = useStore((s) => s.channelStates[channel]);
  const liveIdx = ch?.scriptureSession?.rowId === row.id ? ch.scriptureSession.slideIdx : null;
  const queued = ch?.queuedScripture?.rowId === row.id;
  const showIntro = settings ? hasScriptureIntro(row, settings) : false;
  const onAir = (on: boolean) => (on ? { outline: `2px solid ${colors.onair}`, outlineOffset: 1 } : {});

  return (
    <div role="toolbar" aria-label="Scripture slides" style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
      {showIntro && (
        <Button
          size="md"
          variant="ghost"
          aria-pressed={queued}
          onClick={() => send({ type: "scripture_take_intro", showId: show.id, rowId: row.id, channel })}
          style={{ minWidth: 100, ...onAir(queued) }}
        >
          Intro{queued ? " · queued" : ""}
        </Button>
      )}
      {row.slides.map((slide, i) => (
        <Button
          key={slide.id}
          size="md"
          variant="primary"
          aria-pressed={liveIdx === i}
          onClick={() => send({ type: "scripture_take_slide", showId: show.id, rowId: row.id, slideIdx: i, channel })}
          style={{ flex: "1 1 auto", minWidth: 120, ...onAir(liveIdx === i) }}
        >
          {i + 1}. {slideReference(row.slides, i)}
        </Button>
      ))}
    </div>
  );
}
