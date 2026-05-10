"use client";

import { useEffect, useState } from "react";
import type { Song, SongSessionSummary } from "@overlaysys/core";
import { Button, Pill, colors, radius } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";

interface Props {
  channel: string;
  session: SongSessionSummary;
}

export function SongModePanel({ channel, session }: Props) {
  const { send } = useWs();
  const song = useStore((s) => s.songCache[session.songId]);
  const sttMatch = useStore((s) => s.sttMatches[channel]);

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
    sttMatch &&
    sttMatch.sectionIdx === session.cursor.sectionIdx
  ) ? sttMatch.slideIdx : undefined;

  return (
    <div style={panelStyle()}>
      <Header channel={channel} song={song} session={session} />
      {sttMatch && <SttDebugStrip match={sttMatch} />}
      <div style={{
        display: "grid",
        gridTemplateColumns: "240px minmax(0, 1fr) 320px",
        gap: 16,
        marginTop: 16,
      }}>
        <SectionList
          song={song}
          currentSectionId={currentSectionId ?? null}
          onJump={(sectionId) =>
            send({ type: "song_jump", channel, sectionId })
          }
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
        <span>&rarr; sec {match.sectionIdx + 1}, slide {match.slideIdx + 1}</span>
        <span title="Coverage of cursor slide">cov {(match.coverage * 100).toFixed(0)}%</span>
        <span title="Audio→suggestion latency">{match.latencyMs}ms</span>
        <span style={{ fontWeight: 600, color: aboveTake ? colors.green : colors.textDim }}>
          {(match.confidence * 100).toFixed(0)}%
        </span>
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
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 16 }}>♪ {song.title}</div>
      <div style={{ color: colors.textDim, fontSize: 12 }}>
        {song.author} · {channel}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        <Pill
          tone={onlineCount > 0 ? "good" : "dim"}
          title={
            sttListeners.length === 0
              ? "No STT listeners connected"
              : sttListeners.map((l) => `${l.label ?? l.audioSourceId} ${l.online ? "online" : "offline"}`).join("\n")
          }
        >
          {onlineCount > 0 ? `🎤 STT × ${onlineCount}` : "🎤 STT off"}
        </Pill>
        <label
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}
          title="When on, high-confidence STT matches auto-advance the current slide"
        >
          <input
            type="checkbox"
            checked={session.trustMode}
            onChange={(e) => send({ type: "song_set_trust", channel, trustMode: e.target.checked })}
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
        <Button onClick={() => send({ type: "song_end", channel })} size="sm">
          End Song (Esc)
        </Button>
      </div>
    </div>
  );
}

function SectionList({
  song, currentSectionId, onJump,
}: {
  song: Song; currentSectionId: string | null;
  onJump: (sectionId: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {song.sections.map((sec) => {
        const active = sec.id === currentSectionId;
        return (
          <button
            key={sec.id}
            onClick={() => onJump(sec.id)}
            style={{
              textAlign: "left",
              padding: "10px 12px",
              borderRadius: radius.md,
              border: `1px solid ${colors.border}`,
              background: active ? "rgba(255, 58, 58, 0.18)" : colors.panel2,
              color: colors.text,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14 }}>{sec.label}</div>
            <div style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
              {sec.slides.length} slide{sec.slides.length === 1 ? "" : "s"} · {sec.kind}
            </div>
          </button>
        );
      })}
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
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
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
            <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 8, letterSpacing: 1, textTransform: "uppercase" }}>
              Slide {i + 1}
            </div>
            <div style={{ fontSize: 17, lineHeight: 1.45 }}>
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
  const items: { label: string; lines: string[] }[] = [];
  let { sectionIdx, slideIdx } = session.cursor;
  for (let n = 0; n < 3 && sectionIdx < session.arrangement.length; n++) {
    const sec = song.sections.find((s) => s.id === session.arrangement[sectionIdx]);
    if (!sec) break;
    const slide = sec.slides[slideIdx];
    if (!slide) break;
    items.push({ label: `${sec.label} · slide ${slideIdx + 1}`, lines: slide.lines });
    if (slideIdx + 1 < sec.slides.length) slideIdx += 1;
    else { sectionIdx += 1; slideIdx = 0; }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, color: colors.textDim, textTransform: "uppercase", letterSpacing: 1.2 }}>
        Up Next
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
