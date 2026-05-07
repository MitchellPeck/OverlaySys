import { beforeEach, describe, expect, it } from "vitest";
import type { Song } from "@overlaysys/core";
import * as channels from "./channels";
import * as songSession from "./songSession";

const song: Song = {
  id: "test-song",
  title: "Test Song",
  sections: [
    {
      id: "v1",
      kind: "verse",
      label: "Verse 1",
      slides: [
        { id: "v1s1", lines: ["Line A1", "Line A2"] },
        { id: "v1s2", lines: ["Line B1", "Line B2"] },
      ],
    },
    {
      id: "c",
      kind: "chorus",
      label: "Chorus",
      slides: [
        { id: "c1", lines: ["Chorus 1", "Chorus 2"] },
      ],
    },
  ],
  defaultArrangement: ["v1", "c", "v1"],
};

const CH = "program";

describe("songSession", () => {
  beforeEach(() => {
    songSession.endAll();
  });

  it("starts a session and renders the first slide on the channel", () => {
    songSession.start(CH, {
      song,
      lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement,
      trustMode: false,
    });
    const s = channels.getState(CH);
    expect(s.active?.templateId).toBe("lyric-default");
    expect(s.active?.data.text).toBe("Line A1\nLine A2");
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 0, slideIdx: 0 });
  });

  it("advance(+1) moves to the next slide in the same section", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.advance(CH, 1);
    const s = channels.getState(CH);
    expect(s.active?.data.text).toBe("Line B1\nLine B2");
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 0, slideIdx: 1 });
  });

  it("advance past end of section moves to next section in arrangement", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.advance(CH, 1); // v1 slide 2
    songSession.advance(CH, 1); // -> chorus slide 0
    const s = channels.getState(CH);
    expect(s.active?.data.text).toBe("Chorus 1\nChorus 2");
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 1, slideIdx: 0 });
  });

  it("advance(-1) moves backward across section boundary", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.advance(CH, 1);
    songSession.advance(CH, 1); // chorus
    songSession.advance(CH, -1); // back to v1 slide 2
    const s = channels.getState(CH);
    expect(s.active?.data.text).toBe("Line B1\nLine B2");
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 0, slideIdx: 1 });
  });

  it("advance(+1) past end of arrangement is a no-op", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: ["v1"], trustMode: false,
    });
    songSession.advance(CH, 1); // slide 2
    const before = channels.getState(CH).songSession?.cursor;
    songSession.advance(CH, 1); // would overflow
    const after = channels.getState(CH).songSession?.cursor;
    expect(after).toEqual(before);
  });

  it("jump moves cursor to the requested section", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.jump(CH, "c");
    const s = channels.getState(CH);
    expect(s.active?.data.text).toBe("Chorus 1\nChorus 2");
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 1, slideIdx: 0 });
  });

  it("jump to a section not yet in the arrangement appends it", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: ["v1"], trustMode: false,
    });
    songSession.jump(CH, "c");
    const s = channels.getState(CH);
    expect(s.songSession?.arrangement).toEqual(["v1", "c"]);
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 1, slideIdx: 0 });
  });

  it("blank toggles channel.active to null without ending the session", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.blank(CH);
    const blanked = channels.getState(CH);
    expect(blanked.active).toBe(null);
    expect(blanked.songSession?.blanked).toBe(true);
    songSession.blank(CH);
    const restored = channels.getState(CH);
    expect(restored.active?.data.text).toBe("Line A1\nLine A2");
    expect(restored.songSession?.blanked).toBe(false);
  });

  it("end clears the session and the channel", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.end(CH);
    const s = channels.getState(CH);
    expect(s.songSession).toBeUndefined();
  });
});
