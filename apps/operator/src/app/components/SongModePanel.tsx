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

  const currentSectionId = session.arrangement[session.cursor.sectionIdx];
  const currentSection = song.sections.find((s) => s.id === currentSectionId);

  return (
    <div style={panelStyle()}>
      <Header channel={channel} song={song} session={session} />
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
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 16 }}>♪ {song.title}</div>
      <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
        {song.author} · {channel}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        <label
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, opacity: 0.4, cursor: "not-allowed" }}
          title="Plan B (STT) not yet implemented"
        >
          <input type="checkbox" checked={session.trustMode} disabled readOnly />
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
  section, currentSlideIdx, onSelect,
}: {
  section: Song["sections"][number] | null;
  currentSlideIdx: number;
  onSelect: (slideIdx: number) => void;
}) {
  if (!section) return <div style={{ color: "var(--text-dim)" }}>—</div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
      {section.slides.map((slide, i) => {
        const active = i === currentSlideIdx;
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
