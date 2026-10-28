"use client";

import { useEffect, useState } from "react";
import type { SongSessionSummary } from "@overlaysys/core";
import { Music } from "lucide-react";
import { Button, Switch, colors, radius, useConfirm } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { sttDebugEnabled } from "@/lib/songNav";
import { songEscapeMessages } from "@/lib/shortcutGuards";

/** Mouse clicks must not leave focus on a control: Space is the global advance key and would re-activate it. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

interface Props {
  channel: string;
  session: SongSessionSummary;
}

/**
 * One compact row for the live song: title, Blank, End song, Auto-advance
 * (STT) and the STT strip. The section list and slide grid live in the
 * thumbnail strip, so nothing here repeats them.
 */
export function SongLiveBar({ channel, session }: Props) {
  const { send } = useWs();
  const song = useStore((s) => s.songCache[session.songId]);
  const sttMatch = useStore((s) => s.sttMatches[channel]);
  const sttOnline = useStore((s) => s.sttListeners.some((l) => l.online));
  const confirm = useConfirm();
  // Matcher internals (strategy, coverage, latency) are for tuning, not for
  // running a service: set localStorage "overlaysys:sttDebug" = "1" to see them.
  const [sttDebug, setSttDebug] = useState(false);
  useEffect(() => setSttDebug(sttDebugEnabled()), []);

  useEffect(() => {
    if (!song) send({ type: "get_song", songId: session.songId });
  }, [song, send, session.songId]);

  async function endSong() {
    const ok = await confirm({
      title: "End song?",
      message: `"${song?.title ?? "This song"}" will be cleared from ${channel}.`,
      confirmLabel: "End song",
      danger: true,
    });
    if (!ok) return;
    // Same as the second Esc press: on program it also clears program video.
    if (channel === "program") for (const m of songEscapeMessages()) send(m);
    else send({ type: "song_end", channel });
  }

  return (
    <div
      role="group"
      aria-label="Live song"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minHeight: 36,
        padding: "0 8px",
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
        background: colors.surface,
      }}
    >
      <div
        title={song?.title}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flex: "0 1 200px",
          minWidth: 0,
          fontWeight: 600,
          fontSize: 13,
          whiteSpace: "nowrap",
        }}
      >
        <Music size={14} aria-hidden style={{ flexShrink: 0 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{song ? song.title : "Loading song…"}</span>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onMouseDown={keepFocus}
        aria-pressed={session.blanked}
        onClick={() => send({ type: "song_blank", channel })}
        style={session.blanked ? { background: colors.warn, borderColor: colors.warn, color: colors.bg } : undefined}
      >
        {session.blanked ? "Unblank" : "Blank"}
      </Button>
      <Button size="sm" variant="danger" onMouseDown={keepFocus} onClick={endSong}>
        End song (Esc Esc)
      </Button>
      <span title="When on, high-confidence STT matches advance the slide on their own" style={{ flexShrink: 0 }} onMouseDown={keepFocus}>
        <Switch
          checked={session.trustMode}
          onChange={(on) => send({ type: "song_set_trust", channel, trustMode: on })}
          label="Auto-advance (STT)"
        />
      </span>
      {sttMatch ? (
        sttDebug ? <SttDebugStrip match={sttMatch} /> : <SttStrip match={sttMatch} />
      ) : (
        <span style={{ flex: "1 1 0", minWidth: 0, fontSize: 11, color: colors.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {sttOnline ? "STT listening, nothing heard yet" : "STT off"}
        </span>
      )}
    </div>
  );
}

/** @deprecated use SongLiveBar; kept so StageArea's import keeps working. */
export const SongModePanel = SongLiveBar;

type SttMatchView = NonNullable<ReturnType<typeof useStore.getState>["sttMatches"][string]>;

/** Operator view of the STT match: what it heard and where it points. */
function SttStrip({ match }: { match: SttMatchView }) {
  return (
    <div
      style={{
        flex: "1 1 0",
        minWidth: 0,
        height: 28,
        boxSizing: "border-box",
        padding: "0 10px",
        fontSize: 11,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
        color: colors.textDim,
        display: "flex",
        gap: 8,
        alignItems: "center",
      }}
    >
      <span style={{ fontWeight: 600, color: colors.green }}>STT</span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        &ldquo;{match.hypothesis}&rdquo;
      </span>
      {match.suggestedSlide ? (
        <span>
          suggests section {match.suggestedSlide.sectionIdx + 1}, slide {match.suggestedSlide.slideIdx + 1}
        </span>
      ) : (
        <span>no match</span>
      )}
    </div>
  );
}

function SttDebugStrip({ match }: { match: SttMatchView }) {
  const [showDetails, setShowDetails] = useState(false);
  const aboveTake = match.confidence >= 0.65;
  const strategyLabel =
    match.strategy === "coverage" ? "COV"
    : match.strategy === "audible" ? "AUD"
    : match.strategy === "neighborhood" ? "NBR"
    : "—";
  return (
    <div style={{
      flex: "1 1 0",
      minWidth: 0,
      padding: "4px 10px",
      fontSize: 11,
      background: "rgba(74, 222, 128, 0.06)",
      border: "1px solid rgba(74, 222, 128, 0.2)",
      borderRadius: radius.md,
      color: colors.textDim,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 600, color: colors.green }}>STT</span>
        <span title="Matcher strategy" style={{
          padding: "1px 5px",
          borderRadius: 3,
          background: colors.panel2,
          fontSize: 10,
          letterSpacing: 0.5,
          fontWeight: 600,
        }}>{strategyLabel}</span>
        <span style={{ fontFamily: "ui-monospace, monospace", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          &ldquo;{match.hypothesis}&rdquo;
        </span>
        {match.suggestedSlide ? (
          <>
            <span>&rarr; sec {match.suggestedSlide.sectionIdx + 1}, slide {match.suggestedSlide.slideIdx + 1}</span>
            <span title="Coverage of cursor slide">cov {(match.coverage * 100).toFixed(0)}%</span>
            <span title="Audio→suggestion latency">{match.latencyMs}ms</span>
            <span style={{ fontWeight: 600, color: aboveTake ? colors.green : colors.textDim }}>
              {(match.confidence * 100).toFixed(0)}%
            </span>
          </>
        ) : (
          <span title="STT heard this, but it matched no slide in this song">no match</span>
        )}
        <button
          onClick={() => setShowDetails((v) => !v)}
          title="Toggle matched-token detail"
          style={{
            background: "transparent",
            border: `1px solid ${colors.border}`,
            color: colors.textDim,
            borderRadius: 3,
            cursor: "pointer",
            fontSize: 10,
            padding: "1px 6px",
          }}
        >
          {showDetails ? "−" : "?"}
        </button>
      </div>
      {showDetails && (
        <div style={{
          marginTop: 6,
          paddingTop: 6,
          borderTop: `1px solid ${colors.border}`,
          fontFamily: "ui-monospace, monospace",
          fontSize: 10,
        }}>
          <span style={{ color: colors.textDim }}>matched: </span>
          {match.matchedTokens.length === 0
            ? <span style={{ color: colors.textDim }}>—</span>
            : match.matchedTokens.map((t, i) => (
                <span key={i} style={{
                  display: "inline-block",
                  padding: "1px 5px",
                  margin: "0 3px 2px 0",
                  borderRadius: 2,
                  background: colors.panel2,
                  color: colors.text,
                }}>{t}</span>
              ))
          }
          {!match.isFinal && (
            <span style={{ marginLeft: 8, color: colors.textDim, fontStyle: "italic" }}>partial</span>
          )}
        </div>
      )}
    </div>
  );
}
