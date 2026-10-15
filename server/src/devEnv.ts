import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Source-run env loading.
//
// The packaged desktop host bridges the Supabase credentials from
// apps/desktop/.env into the server child (apps/desktop/src/serverEnv.ts).
// A server started from source (`pnpm dev`, which `pnpm desktop` also
// relies on) has no such parent — it inherits the shell, and the shell has
// nothing, so cloud sync reported "unavailable" in every dev session. Read
// the same file the host reads, with the same precedence, and never
// override a value the shell already set.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The files a source-run server consults, first hit wins per key. */
export function defaultDevEnvFiles(): string[] {
  const desktop = path.join(REPO_ROOT, "apps", "desktop");
  return [path.join(desktop, ".env.local"), path.join(desktop, ".env")];
}

/** Parse dotenv-style text: `KEY=VALUE`, optional quotes, `#` comments. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Fill `env` from each file in order. A key already present in `env`
 * (shell, or an earlier file) is never overwritten. Missing files are
 * skipped. Returns the keys that were applied so the caller can log them.
 */
export function loadDevEnvFiles(
  env: Record<string, string | undefined>,
  files: string[],
): string[] {
  const applied: string[] = [];
  for (const file of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(parseEnvFile(raw))) {
      if (env[key] !== undefined) continue;
      env[key] = value;
      applied.push(key);
    }
  }
  return applied;
}
