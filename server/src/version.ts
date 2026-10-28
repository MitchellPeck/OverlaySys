import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readVersion(): string {
  if (process.env["OVERLAYSYS_VERSION"]) return process.env["OVERLAYSYS_VERSION"];
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Server package version (OVERLAYSYS_VERSION overrides, e.g. from the desktop host). */
export const SERVER_VERSION = readVersion();

/** Process start, for /health uptime. */
export const STARTED_AT = Date.now();
