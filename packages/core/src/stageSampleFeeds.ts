import type { StageFeed } from "./stageFeed";
import { NONE_SLIDE } from "./stageFeed";
import type { StageLayout } from "./stageLayout";
import { CURRENT_ITEM_TIMER_ID } from "./stageTimers";
import { encodeTimerValue } from "./timeField";

/** Fake feeds the layout designer renders widgets against. */
export const STAGE_SAMPLE_KINDS = [
  "song",
  "scripture",
  "notes",
  "videoTimer",
  "message",
  "itemOvertime",
  "pcoLive",
] as const;
export type StageSampleKind = (typeof STAGE_SAMPLE_KINDS)[number];

export const STAGE_SAMPLE_LABELS: Record<StageSampleKind, string> = {
  song: "Song",
  scripture: "Scripture",
  notes: "Sermon notes",
  videoTimer: "Video + timer",
  message: "Message",
  itemOvertime: "Item countdown (overtime)",
  pcoLive: "PCO Live",
};

export function sampleStageFeed(kind: StageSampleKind, layout: StageLayout, now: number): StageFeed {
  const base: StageFeed = {
    layout,
    current: NONE_SLIDE,
    next: NONE_SLIDE,
    row: { title: "Sample item", cue: "1" },
    nextRow: { title: "Next item", cue: "2" },
    timers: [],
    video: null,
    notes: null,
    message: null,
    service: null,
    serverNow: now,
  };

  switch (kind) {
    case "song":
      return {
        ...base,
        current: { kind: "lyric", lines: ["Amazing grace, how sweet the sound", "That saved a wretch like me"] },
        next: { kind: "lyric", lines: ["I once was lost, but now am found", "Was blind, but now I see"] },
        row: { title: "Amazing Grace", cue: "Verse 1" },
        nextRow: { title: "Amazing Grace", cue: "Chorus" },
      };
    case "scripture":
      return {
        ...base,
        current: {
          kind: "scripture",
          lines: [
            "For God so loved the world, that he gave his only Son,",
            "that whoever believes in him should not perish but have eternal life.",
          ],
          reference: "John 3:16",
        },
        next: {
          kind: "scripture",
          lines: [
            "For God did not send his Son into the world to condemn the world,",
            "but in order that the world might be saved through him.",
          ],
          reference: "John 3:17",
        },
        row: { title: "John 3", cue: "16" },
        nextRow: { title: "John 3", cue: "17" },
      };
    case "notes":
      return {
        ...base,
        notes: {
          id: "sample-notes",
          title: "Sermon: Grace Abounds",
          points: [
            { heading: "Introduction", markdown: "Welcome and **context** for the passage." },
            { heading: "Grace received", markdown: "- Freely given\n- Not earned" },
            { heading: "Grace lived out", markdown: "How we respond day to day." },
            { heading: "Closing", markdown: "Prayer and invitation." },
          ],
          pointIdx: 1,
          scrollOffset: 0,
        },
      };
    case "videoTimer":
      return {
        ...base,
        video: { status: "playing", currentTime: 25, duration: 120, at: now, label: "Announcement video" },
        timers: [
          {
            id: "sample-timer",
            label: "Countdown",
            source: "manual",
            overtime: false,
            running: true,
            mode: "countdown",
            value: encodeTimerValue({ anchor: now + 240_000, durationMs: 240_000 }),
          },
        ],
      };
    case "message":
      return { ...base, message: { text: "Wrap up", sentAt: now } };
    case "itemOvertime":
      return {
        ...base,
        timers: [
          {
            id: CURRENT_ITEM_TIMER_ID,
            label: "Sermon",
            source: "item",
            overtime: true,
            running: true,
            mode: "countdown",
            value: encodeTimerValue({ anchor: now - 83_000, durationMs: 1_800_000 }),
          },
        ],
      };
    case "pcoLive":
      return {
        ...base,
        row: { title: "Sermon", cue: "5" },
        nextRow: { title: "Response", cue: "6" },
        timers: [
          {
            id: CURRENT_ITEM_TIMER_ID,
            label: "Sermon",
            source: "pco",
            overtime: true,
            running: true,
            mode: "countdown",
            value: encodeTimerValue({ anchor: now - 600_000 + 1_800_000, durationMs: 1_800_000 }),
          },
        ],
        service: {
          source: "pco",
          planTitle: "Sunday 9:00",
          itemIndex: 4,
          itemCount: 12,
          current: { id: "sample-item", title: "Sermon", startedAt: now - 600_000, lengthSec: 1800 },
          next: { title: "Response" },
          laterLengthSec: 900,
          plannedEndAt: now + 2_400_000,
          status: "live",
        },
      };
  }
}
