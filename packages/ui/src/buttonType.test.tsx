import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

describe("button types", () => {
  it("Button defaults to type=button so it never submits a surrounding form", () => {
    expect(renderToStaticMarkup(<Button>Go</Button>)).toContain('type="button"');
  });
  it("IconButton defaults to type=button", () => {
    expect(renderToStaticMarkup(<IconButton aria-label="x">x</IconButton>)).toContain('type="button"');
  });
});
