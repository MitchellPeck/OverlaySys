import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Renderer } from "./Renderer";

const params = new URLSearchParams(location.search);
const channel = params.get("channel") ?? "program";
const debug = params.has("debug");

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <Renderer channel={channel} debug={debug} />
  </StrictMode>,
);
