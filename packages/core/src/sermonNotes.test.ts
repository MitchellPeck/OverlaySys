import { describe, expect, it } from "vitest";
import { ShowSchema } from "./show";
import { splitPoints, titleFromMarkdown } from "./sermonNotes";

describe("splitPoints", () => {
  it("splits on headings of any level, keeping the heading line in the point", () => {
    const pts = splitPoints("## Intro\nHello\n\n## Point one\nText **bold**\n### Sub\nMore");
    expect(pts.map((p) => p.heading)).toEqual(["Intro", "Point one", "Sub"]);
    expect(pts[1]!.markdown).toBe("## Point one\nText **bold**");
  });

  it("drops a leading H1 title when H2s follow", () => {
    const md = "# Placeholder sermon\n## Point one\nBody\n## Point two\nBody";
    expect(splitPoints(md).map((p) => p.heading)).toEqual(["Point one", "Point two"]);
    expect(titleFromMarkdown(md)).toBe("Placeholder sermon");
  });

  it("keeps a document of only H1s as points and has no title", () => {
    const md = "# One\nA\n# Two\nB";
    expect(splitPoints(md).map((p) => p.heading)).toEqual(["One", "Two"]);
    expect(titleFromMarkdown(md)).toBeNull();
  });

  it("has no title for text without headings", () => {
    expect(titleFromMarkdown("First block\n\nSecond")).toBeNull();
  });

  it("keeps text before the first heading as its own point", () => {
    const pts = splitPoints("Opening prayer\n\n# One\nA");
    expect(pts.map((p) => p.heading)).toEqual(["Opening prayer", "One"]);
  });

  it("falls back to blank-line blocks when there are no headings", () => {
    const pts = splitPoints("First block\nline two\n\n\nSecond block");
    expect(pts).toEqual([
      { heading: "First block", markdown: "First block\nline two" },
      { heading: "Second block", markdown: "Second block" },
    ]);
  });

  it("truncates long first-line headings to 60 chars with an ellipsis", () => {
    const long = "x".repeat(80);
    expect(splitPoints(long)[0]!.heading).toBe("x".repeat(59) + "…");
  });

  it("strips list markers and emphasis from a block's heading", () => {
    expect(splitPoints("- **Grace** is free")[0]!.heading).toBe("Grace is free");
  });

  it("names an empty heading Untitled", () => {
    expect(splitPoints("# \nbody")[0]!.heading).toBe("Untitled");
  });

  it("returns [] for empty or whitespace input", () => {
    expect(splitPoints("")).toEqual([]);
    expect(splitPoints("  \n\n \t")).toEqual([]);
  });

  it("normalizes CRLF", () => {
    expect(splitPoints("# A\r\nx\r\n# B\r\ny").map((p) => p.heading)).toEqual(["A", "B"]);
  });
});

describe("Show sermon notes fields", () => {
  it("parses shows without sermon notes unchanged", () => {
    const s = ShowSchema.parse({ id: "s", name: "S", projectId: "p", rows: [], songs: [] });
    expect(s.sermonNotes).toBeUndefined();
  });
  it("accepts notes and a row link", () => {
    const s = ShowSchema.parse({
      id: "s",
      name: "S",
      projectId: "p",
      songs: [],
      sermonNotes: [{ id: "n1", title: "Sermon", body: "# A" }],
      rows: [{ kind: "graphic", id: "r", templateId: "t", data: {}, sermonNotesId: "n1" }],
    });
    expect(s.sermonNotes?.[0]?.id).toBe("n1");
    expect(s.rows[0]).toMatchObject({ sermonNotesId: "n1" });
  });
});
