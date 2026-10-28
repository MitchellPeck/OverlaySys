"use client";

import { useEffect, useState } from "react";
import type { Song, SongSessionSummary } from "@overlaysys/core";
import { Mic, Music } from "lucide-react";
import { Button, Pill, StatusDot, colors, radius } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useDialog } from "@/lib/dialog";
import { slideDeltaTo, sttDebugEnabled, upcomingSlides } from "@/lib/songNav";

interface Props {
  channel: string;
  session: SongSessionSummary;
}

export function SongModePanel({ channel, session }: Props) {
  const { send } = useWs();
  const song = useStore((s) => s.songCache[session.songId]);
  const sttMatch = useStore((s) => s.sttMatches[channel]);
  const sttOnline = useStore((s) => s.sttListeners.some((l) => l.online));
  // Matcher internals (strategy, coverage, latency) are for tuning, not for
  // running a service: set localStorage "overlaysys:sttDebug" = "1" to see them.
  const [sttDebug, setSttDebug] = useState(false);
  useEffect(() => setSttDebug(sttDebugEnabled()), []);

  useEffect(() => {
    if (!song) {
      send({ type: "get_song", songId: session.songId });
    }
  }, [song, send, session.songId]);

  if (!song) {
    return <div style={panelStyle()}>Loading song…</div>;
  }

  const currentSectionId = session.arrangement[session.cursor.sectionIdx];
  const currentSection = song.sections.find((s) => s.id === currentSectionId);

  const suggestedSlideIdx = (
    sttMatch?.suggestedSlide &&
    sttMatch.suggestedSlide.sectionIdx === session.cursor.sectionIdx
  ) ? sttMatch.suggestedSlide.slideIdx : undefined;

  return (
    <div style={panelStyle()}>
      <Header channel={channel} song={song} session={session} />
      {sttMatch ? (
        sttDebug ? <SttDebugStrip match={sttMatch} /> : <SttStrip match={sttMatch} />
      ) : sttOnline ? (
        <div style={{ marginTop: 8, fontSize: 11, color: colors.textDim }}>
          STT listening — nothing heard yet
        </div>
      ) : null}
      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(150px, 200px) minmax(0, 1fr) minmax(180px, 240px)",
        gap: 16,
        marginTop: 16,
      }}>
        <SectionList
          song={song}
          session={session}
          onJumpTo={(arrangementIdx) => {
            // Land on exactly this occurrence of a repeated section.
            const delta = slideDeltaTo(session.arrangement, song.sections, session.cursor, arrangementIdx);
            const sectionId = session.arrangement[arrangementIdx];
            if (delta === null) {
              if (sectionId) send({ type: "song_jump", channel, sectionId });
            } else if (delta !== 0) {
              send({ type: "song_advance", channel, delta });
            }
          }}
          onJumpSection={(sectionId) => send({ type: "song_jump", channel, sectionId })}
        />
        <SlideGrid
          section={currentSection ?? null}
          currentSlideIdx={session.cursor.slideIdx}
          suggestedSlideIdx={suggestedSlideIdx}
          onSelect={(slideIdx) =>
            currentSectionId &&
            send({
              type: "song_jump",
              channel,
              sectionId: currentSectionId,
              slideIdx,
            })
          }
        />
        <UpNext song={song} session={session} />
      </div>
    </div>
  );
}

type SttMatchView = NonNullable<ReturnType<typeof useStore.getState>["sttMatches"][string]>;

/** Operator view of the STT match: what it heard and where it points. */
function SttStrip({ match }: { match: SttMatchView }) {
  return (
    <div
      style={{
        marginTop: 8,
        padding: "6px 10px",
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
      marginTop: 8,
      padding: "6px 10px",
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

function Header({ channel, song, session }: { channel: string; song: Song; session: SongSessionSummary }) {
  const { send } = useWs();
  const sttListeners = useStore((s) => s.sttListeners);
  const onlineCount = sttListeners.filter((l) => l.online).length;
  const { confirm, dialog } = useDialog();
  async function endSong() {
    const ok = await confirm({
      title: "End song?",
      message: `"${song.title}" will be cleared from ${channel === "program" ? "program" : channel}.`,
      confirmLabel: "End song",
      destructive: true,
    });
    if (ok) send({ type: "song_end", channel });
  }
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, rowGap: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 16 }}><Music size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> {song.title}</div>
      <div style={{ color: colors.textDim, fontSize: 12 }}>
        {song.author} · {channel}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        <StatusDot
          tone={onlineCount > 0 ? "good" : "dim"}
          label={
            <>
              <Mic size={14} aria-hidden style={{ verticalAlign: "-2px" }} />{" "}
              {onlineCount > 0 ? `STT × ${onlineCount}` : "STT off"}
            </>
          }
          title={
            sttListeners.length === 0
              ? "No STT listeners connected"
              : sttListeners.map((l) => `${l.label ?? l.audioSourceId} ${l.online ? "online" : "offline"}`).join("\n")
          }
        />
        <label
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}
          title="When on, high-confidence STT matches auto-advance the current slide"
        >
          <input
            type="checkbox"
            checked={session.trustMode}
            onChange={(e) => {
              send({ type: "song_set_trust", channel, trustMode: e.target.checked });
              // Hand Space back to the song shortcuts instead of re-toggling Trust.
              e.currentTarget.blur();
            }}
          />
          Trust Mode
        </label>
        <Button
          onClick={() => send({ type: "song_blank", channel })}
          variant={session.blanked ? "primary" : "secondary"}
          size="sm"
        >
          {session.blanked ? "Unblank" : "Blank (.)"}
        </Button>
        <Button onClick={endSong} size="sm">
          End Song{channel === "program" ? " (Esc)" : ""}
        </Button>
      </div>
      {dialog}
    </div>
  );
}

/**
 * The arrangement in order, so the operator sees where they are in it (a
 * repeated chorus appears once per occurrence). Sections the arrangement
 * leaves out follow under "Not in arrangement"; jumping to one appends it.
 */
function SectionList({
  song, session, onJumpTo, onJumpSection,
}: {
  song: Song;
  session: SongSessionSummary;
  onJumpTo: (arrangementIdx: number) => void;
  onJumpSection: (sectionId: string) => void;
}) {
  const unused = song.sections.filter((s) => !session.arrangement.includes(s.id));
  const sectionButton = (key: string, sec: Song["sections"][number], state: "current" | "past" | "next", onClick: () => void) => (
    <button
      key={key}
      onClick={(e) => {
        onClick();
        e.currentTarget.blur();
      }}
      aria-current={state === "current" ? "step" : undefined}
      style={{
        textAlign: "left",
        padding: "10px 12px",
        borderRadius: radius.md,
        border: `1px solid ${state === "current" ? colors.accent : colors.border}`,
        background: state === "current" ? "rgba(255, 58, 58, 0.18)" : colors.panel2,
        color: state === "past" ? colors.textDim : colors.text,
        cursor: "pointer",
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 14 }}>
        {state === "current" && <span aria-hidden style={{ color: colors.accent, marginRight: 6 }}>▶</span>}
        {sec.label}
      </div>
      <div style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
        {sec.slides.length} slide{sec.slides.length === 1 ? "" : "s"} · {sec.kind}
      </div>
    </button>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {session.arrangement.map((id, i) => {
        const sec = song.sections.find((s) => s.id === id);
        if (!sec) return null;
        const state = i === session.cursor.sectionIdx ? "current" : i < session.cursor.sectionIdx ? "past" : "next";
        return sectionButton(`${i}:${id}`, sec, state, () => onJumpTo(i));
      })}
      {unused.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 600, color: colors.textDim, marginTop: 6 }}>Not in arrangement</div>
          {unused.map((sec) => sectionButton(`x:${sec.id}`, sec, "next", () => onJumpSection(sec.id)))}
        </>
      )}
    </div>
  );
}

function SlideGrid({
  section, currentSlideIdx, suggestedSlideIdx, onSelect,
}: {
  section: Song["sections"][number] | null;
  currentSlideIdx: number;
  suggestedSlideIdx?: number;
  onSelect: (slideIdx: number) => void;
}) {
  if (!section) return <div style={{ color: colors.textDim }}>—</div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 240px), 1fr))", gap: 12 }}>
      {section.slides.map((slide, i) => {
        const active = i === currentSlideIdx;
        const isSuggested = suggestedSlideIdx === i && currentSlideIdx !== i;
        return (
          <button
            key={slide.id}
            onClick={() => onSelect(i)}
            style={{
              padding: 18,
              borderRadius: radius.lg,
              border: active ? `2px solid ${colors.accent}` : `1px solid ${colors.border}`,
              background: active ? "rgba(255, 58, 58, 0.12)" : colors.panel2,
              color: colors.text,
              cursor: "pointer",
              textAlign: "left",
              minHeight: 120,
              outline: isSuggested ? `2px dashed ${colors.green}` : undefined,
              outlineOffset: isSuggested ? "1px" : undefined,
            }}
          >
            <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 8, fontWeight: 600 }}>
              Slide {i + 1}
            </div>
            <div style={{ fontSize: 17, lineHeight: 1.45, overflowWrap: "anywhere" }}>
              {slide.lines.map((line, j) => (
                <div key={j}>{line}</div>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function UpNext({ song, session }: { song: Song; session: SongSessionSummary }) {
  // Starts after the slide already on screen.
  const items = upcomingSlides(session.arrangement, song.sections, session.cursor, 3);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textDim }}>
        Up next
      </div>
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            padding: 10,
            borderRadius: radius.md,
            border: `1px solid ${colors.border}`,
            background: i === 0 ? "rgba(255,58,58,0.08)" : colors.panel2,
            fontSize: 12,
          }}
        >
          <div style={{ color: colors.textDim, marginBottom: 4, fontSize: 10, letterSpacing: 1 }}>{item.label}</div>
          {item.lines.map((line, j) => (
            <div key={j} style={{ color: colors.text, lineHeight: 1.4 }}>{line}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

function panelStyle(): React.CSSProperties {
  return {
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    padding: 12,
    background: colors.panel,
  };
}
