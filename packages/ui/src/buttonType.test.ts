import * as React from "react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

// The components use the classic JSX transform under vitest, which needs React in scope.
(globalThis as { React?: typeof React }).React = React;

describe("button types", () => {
  it("Button defaults to type=button so it never submits a surrounding form", () => {
    expect(renderToStaticMarkup(createElement(Button, null, "Go"))).toContain('type="button"');
  });
  it("IconButton defaults to type=button", () => {
    expect(renderToStaticMarkup(createElement(IconButton, { "aria-label": "x" }, "x"))).toContain('type="button"');
  });
});
