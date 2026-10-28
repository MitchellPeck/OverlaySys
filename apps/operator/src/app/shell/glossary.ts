// Banned UI copy (D11 glossary). Each entry pairs a pattern with the term to use.
// glossary.test.ts scans string literals and JSX text for these.

export const BANNED_COPY: { pattern: RegExp; use: string }[] = [
  { pattern: /Cue → PVW|Cue Preview|Start Program|Take → Program|TAKE \(PVW/, use: "Cue / Take / Clear" },
  { pattern: /STT Spawner/, use: "Speech-to-text" },
  { pattern: /Trust Mode/, use: "Auto-advance (STT)" },
  { pattern: /Pastor notes/, use: "Sermon notes" },
  { pattern: /\bFire hotcard\b/, use: "Show hotcard" },
  { pattern: /Channel hint/, use: "Output" },
];
