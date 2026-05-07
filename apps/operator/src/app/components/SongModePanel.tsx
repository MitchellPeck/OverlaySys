"use client";

import { useEffect } from "react";
import type { Song, SongSessionSummary } from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";

interface Props {
  channel: string;
  session: SongSessionSummary;
}

export function SongModePanel({ channel, session }: Props) {
  const { send } = useWs();
  const song = useStore((s) => s.songCache[session.songId]);

  useEffect(() => {
    if (!song) {
      send({ type: "get_song", songId: session.songId });
    }
  }, [song, send, session.songId]);

  if (!song) {
    return <div style={panelStyle()}>Loading song…</div>;
  }

  const sttMatch = useStore((s) => s.sttMatches[channel]);

  const currentSectionId = session.arrangement[session.cursor.sectionIdx];
  const currentSection = song.sections.find((s) => s.id === currentSectionId);

  const suggestedSlideIdx = (
    sttMatch &&
    sttMatch.sectionIdx === session.cursor.sectionIdx
  ) ? sttMatch.slideIdx : undefined;

  return (
    <div style={panelStyle()}>
      <Header channel={channel} song={song} session={session} />
      {sttMatch && (
        <div style={{
          marginTop: 8,
          padding: "6px 10px",
          fontSize: 11,
          background: "rgba(74, 222, 128, 0.06)",
          border: "1px solid rgba(74, 222, 128, 0.2)",
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "var(--text-dim)",
        }}>
          <span style={{ fontWeight: 600, color: "#4ade80" }}>STT</span>
          <span style={{ fontFamily: "ui-monospace, monospace", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            &ldquo;{sttMatch.hypothesis}&rdquo;
          </span>
          <span>&rarr; section {sttMatch.sectionIdx + 1}, slide {sttMatch.slideIdx + 1}</span>
          <span style={{ fontWeight: 600, color: sttMatch.confidence >= 0.65 ? "#4ade80" : "var(--text-dim)" }}>
            {(sttMatch.confidence * 100).toFixed(0)}%
          </span>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 220px", gap: 12, marginTop: 12 }}>
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

function Header({ channel, song, session }: { channel: string; song: Song; session: SongSessionSummary }) {
  const { send } = useWs();
  const sttListeners = useStore((s) => s.sttListeners);
  const onlineCount = sttListeners.filter((l) => l.online).length;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 16 }}>♪ {song.title}</div>
      <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
        {song.author} · {channel}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        <span
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 999,
            background: onlineCount > 0 ? "rgba(74, 222, 128, 0.15)" : "rgba(255, 255, 255, 0.06)",
            color: onlineCount > 0 ? "#4ade80" : "var(--text-dim)",
            border: `1px solid ${onlineCount > 0 ? "rgba(74, 222, 128, 0.4)" : "var(--border)"}`,
          }}
          title={
            sttListeners.length === 0
              ? "No STT listeners connected"
              : sttListeners.map((l) => `${l.label ?? l.audioSourceId} ${l.online ? "online" : "offline"}`).join("\n")
          }
        >
          {onlineCount > 0 ? `🎤 STT × ${onlineCount}` : "🎤 STT off"}
        </span>
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
        <button
          onClick={() => send({ type: "song_blank", channel })}
          style={btn(session.blanked ? "primary" : "default")}
        >
          {session.blanked ? "Unblank" : "Blank (.)"}
        </button>
        <button onClick={() => send({ type: "song_end", channel })} style={btn()}>
          End Song (Esc)
        </button>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {song.sections.map((sec) => {
        const active = sec.id === currentSectionId;
        return (
          <button
            key={sec.id}
            onClick={() => onJump(sec.id)}
            style={{
              textAlign: "left",
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: active ? "rgba(255, 58, 58, 0.18)" : "var(--panel-2)",
              color: "var(--text)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 600 }}>{sec.label}</div>
            <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
              {sec.slides.length} slide{sec.slides.length === 1 ? "" : "s"}
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
  if (!section) return <div style={{ color: "var(--text-dim)" }}>—</div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
      {section.slides.map((slide, i) => {
        const active = i === currentSlideIdx;
        const isSuggested = suggestedSlideIdx === i && currentSlideIdx !== i;
        return (
          <button
            key={slide.id}
            onClick={() => onSelect(i)}
            style={{
              padding: 12,
              borderRadius: 4,
              border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
              background: active ? "rgba(255, 58, 58, 0.12)" : "var(--panel-2)",
              color: "var(--text)",
              cursor: "pointer",
              textAlign: "left",
              minHeight: 80,
              outline: isSuggested ? "2px dashed #4ade80" : undefined,
              outlineOffset: isSuggested ? "1px" : undefined,
            }}
          >
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
              Slide {i + 1}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.4 }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 1 }}>
        Up Next
      </div>
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            padding: 8,
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: i === 0 ? "rgba(255,58,58,0.08)" : "var(--panel-2)",
            fontSize: 11,
          }}
        >
          <div style={{ color: "var(--text-dim)", marginBottom: 2 }}>{item.label}</div>
          {item.lines.map((line, j) => (
            <div key={j} style={{ color: "var(--text)" }}>{line}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

function panelStyle(): React.CSSProperties {
  return {
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: 12,
    background: "var(--panel)",
  };
}

function btn(kind: "default" | "primary" = "default"): React.CSSProperties {
  return {
    padding: "6px 10px",
    background: kind === "primary" ? "var(--accent)" : "var(--panel-2)",
    color: kind === "primary" ? "#fff" : "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 12,
  };
}
