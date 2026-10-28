import { useEffect, useRef, useState } from "react";
import type { StageFeed } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { StageWidgetView } from "./widgets";

/**
 * Re-render at 4 Hz so clocks, timers and video remaining tick locally.
 *
 * The offset is re-measured on every feed update, so it changes constantly;
 * it lives in a ref so the interval is created once. (Keying the effect on
 * it restarted the interval on every update — with feeds arriving faster
 * than 250 ms, e.g. during video playback, the clock never ticked.)
 */
function useNow(offsetMs: number): number {
  const offsetRef = useRef(offsetMs);
  offsetRef.current = offsetMs;
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offsetRef.current), 250);
    return () => clearInterval(id);
  }, []);
  return now;
}

function useFitScale(w: number, h: number): number {
  const calc = () => Math.min(window.innerWidth / w, window.innerHeight / h);
  const [scale, setScale] = useState(calc);
  useEffect(() => {
    const onResize = () => setScale(calc());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h]);
  return scale;
}

export function StageView({
  feed,
  offsetMs,
  connected,
  send,
}: {
  feed: StageFeed;
  offsetMs: number;
  connected: boolean;
  send?: (msg: ClientMessage) => void;
}) {
  const { layout } = feed;
  const now = useNow(offsetMs);
  const scale = useFitScale(layout.size.w, layout.size.h);
  return (
    <div style={{ position: "fixed", inset: 0, background: layout.background, zIndex: 10, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: layout.size.w,
          height: layout.size.h,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "50% 50%",
        }}
      >
        {layout.widgets.map((w) => (
          <StageWidgetView key={w.id} widget={w} feed={feed} nowMs={now} send={send} />
        ))}
      </div>
      {!connected && (
        <div
          style={{
            position: "fixed",
            right: 12,
            bottom: 12,
            padding: "4px 10px",
            borderRadius: 6,
            background: "rgba(255,60,60,0.85)",
            color: "#fff",
            font: "600 14px system-ui, sans-serif",
          }}
        >
          disconnected
        </div>
      )}
    </div>
  );
}
