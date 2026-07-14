import { z } from "zod";

// Default model file path. The installer/UI manages downloads into
// ~/whisper-models/ so this matches what `brew install whisper-cpp` users
// expect from existing documentation.
export const DEFAULT_MODEL_PATH = "~/whisper-models/ggml-base.en.bin";

// Curated list of whisper.cpp ggml models. The UI shows these as a dropdown
// of "presets" alongside any other .bin files already in the models dir, and
// the installer downloads them from HuggingFace when the user picks one
// that's not on disk yet.
export const PRESET_MODELS: ReadonlyArray<{
  id: string;
  name: string;
  filename: string;
  url: string;
  sizeBytes: number;
}> = [
  {
    id: "tiny.en",
    name: "Tiny English (75 MB, fastest)",
    filename: "ggml-tiny.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    sizeBytes: 77_700_000,
  },
  {
    id: "base.en",
    name: "Base English (142 MB, balanced)",
    filename: "ggml-base.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    sizeBytes: 147_900_000,
  },
  {
    id: "small.en",
    name: "Small English (466 MB, accurate)",
    filename: "ggml-small.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    sizeBytes: 487_600_000,
  },
  {
    id: "small.en-q5_1",
    name: "Small English Q5 (181 MB, quantized)",
    filename: "ggml-small.en-q5_1.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-q5_1.bin",
    sizeBytes: 189_700_000,
  },
  {
    id: "medium.en",
    name: "Medium English (1.5 GB, very accurate)",
    filename: "ggml-medium.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin",
    sizeBytes: 1_533_000_000,
  },
  {
    id: "medium.en-q5_0",
    name: "Medium English Q5 (514 MB, quantized)",
    filename: "ggml-medium.en-q5_0.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en-q5_0.bin",
    sizeBytes: 539_200_000,
  },
  {
    id: "large-v3",
    name: "Large v3 (3.1 GB, best accuracy)",
    filename: "ggml-large-v3.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
    sizeBytes: 3_094_000_000,
  },
  {
    id: "large-v3-q5_0",
    name: "Large v3 Q5 (1.1 GB, quantized)",
    filename: "ggml-large-v3-q5_0.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-q5_0.bin",
    sizeBytes: 1_080_000_000,
  },
];

export const STEP_OPTIONS_MS = [200, 500, 700, 1000, 2000, 3000];
export const LENGTH_OPTIONS_MS = [3000, 5000, 7000, 10_000, 15_000, 20_000];

export const SttSpawnerConfigSchema = z.object({
  // When true, the server starts the spawner automatically on boot.
  autoStart: z.boolean().default(false),

  // Path to the whisper.cpp ggml model file (`-m` flag). May start with
  // `~` for home expansion; resolved at spawn time. Selected via the UI's
  // model dropdown (preset or custom-installed).
  modelPath: z.string().default(DEFAULT_MODEL_PATH),

  // Inference cadence — `--step` in milliseconds. Lower is more responsive
  // but burns more CPU/GPU per second of audio.
  stepMs: z.number().int().positive().default(500),

  // Sliding window — `--length` in milliseconds. Larger gives the model
  // more context per inference; trades latency for accuracy.
  lengthMs: z.number().int().positive().default(5000),

  // SDL2 capture-device index (`-c` flag). -1 lets whisper-stream pick the
  // system default device. The UI populates a dropdown by spawning
  // whisper-stream once and parsing its "found N capture devices" output.
  captureDevice: z.number().int().min(-1).default(-1),

  // Escape hatch. When set to a non-empty string, the structured fields
  // (modelPath/stepMs/lengthMs/captureDevice) are ignored and this raw
  // shell command is used verbatim instead. Lets advanced users wire in
  // cloud STT or any other pipeline that emits transcribed text on stdout.
  customCommand: z.string().default(""),
});
export type SttSpawnerConfig = z.infer<typeof SttSpawnerConfigSchema>;

export const DEFAULT_STT_SPAWNER_CONFIG: SttSpawnerConfig = {
  autoStart: false,
  modelPath: DEFAULT_MODEL_PATH,
  stepMs: 500,
  lengthMs: 5000,
  captureDevice: -1,
  customCommand: "",
};

/**
 * Expand a leading `~` in a path to the user's home directory. Uses
 * process.env.HOME (or USERPROFILE on Windows) — kept synchronous and
 * portable so it works from both the server and any future call sites.
 */
export function expandHome(p: string): string {
  if (!p.startsWith("~")) return p;
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  if (!home) return p;
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return home + p.slice(1);
  return p;
}

/**
 * Single-quote a string for safe use inside a bash `-c` argument. Standard
 * trick: close-quote, escape the literal quote, reopen-quote. Never embeds
 * the input unescaped, so paths/values with spaces/special chars are safe.
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the shell command for the STT spawner from the config. If a
 * customCommand is set it wins; otherwise we compose a whisper-stream
 * invocation from the structured fields.
 */
export function buildSttCommand(cfg: SttSpawnerConfig): string {
  if (cfg.customCommand.trim().length > 0) return cfg.customCommand;
  const modelArg = shellQuote(expandHome(cfg.modelPath));
  return `whisper-stream -m ${modelArg} --step ${cfg.stepMs} --length ${cfg.lengthMs} -c ${cfg.captureDevice}`;
}

export const SttSpawnerStateSchema = z.enum([
  "idle",
  "starting",
  "running",
  "stopped",
  "error",
]);
export type SttSpawnerState = z.infer<typeof SttSpawnerStateSchema>;

export const SttSpawnerStatusSchema = z.object({
  state: SttSpawnerStateSchema,
  pid: z.number().nullable(),
  startedAt: z.number().nullable(), // epoch ms
  lastError: z.string().nullable(),
  // Last 100 stderr lines from the child process (most recent last).
  recentLogs: z.array(z.string()),
});
export type SttSpawnerStatus = z.infer<typeof SttSpawnerStatusSchema>;

// ── Installer / presence types ──────────────────────────────────────────

export const SttBinaryPresenceSchema = z.object({
  // Resolved absolute path to whisper-stream if found on PATH; null if not.
  path: z.string().nullable(),
  // Version string from --help banner, when detectable. Best-effort.
  version: z.string().nullable(),
});
export type SttBinaryPresence = z.infer<typeof SttBinaryPresenceSchema>;

export const SttModelFileSchema = z.object({
  // Path on disk. Either inside the managed models dir or a user-pointed path.
  path: z.string(),
  // Filename portion, e.g. "ggml-base.en.bin".
  filename: z.string(),
  // File size in bytes when present; null when missing.
  sizeBytes: z.number().nullable(),
  // True when path exists and is a regular file.
  present: z.boolean(),
});
export type SttModelFile = z.infer<typeof SttModelFileSchema>;

export const SttPresenceSchema = z.object({
  binary: SttBinaryPresenceSchema,
  selectedModel: SttModelFileSchema,
  // OS hint so the UI can show install instructions for the current platform.
  platform: z.enum(["darwin", "linux", "win32", "other"]),
  // Whether a package manager we can auto-invoke is available.
  // mac: brew on PATH. linux: apt or pacman. win: winget. Else null.
  packageManager: z.enum(["brew", "apt", "pacman", "winget"]).nullable(),
});
export type SttPresence = z.infer<typeof SttPresenceSchema>;

export const SttCaptureDeviceSchema = z.object({
  // SDL2 capture device index as enumerated by whisper-stream. -1 always
  // appears first to represent "system default".
  id: z.number().int(),
  name: z.string(),
});
export type SttCaptureDevice = z.infer<typeof SttCaptureDeviceSchema>;

export const SttInstallProgressSchema = z.object({
  // Stable identifier for the install/download job so the UI can track
  // and cancel it. For binary installs we use "binary"; for models we
  // use the resolved filename.
  jobId: z.string(),
  // Job lifecycle.
  state: z.enum(["pending", "running", "done", "error", "cancelled"]),
  // 0..1 when known (downloads with content-length), else null.
  progress: z.number().min(0).max(1).nullable(),
  // Bytes downloaded / total when known. Useful for showing a rate.
  bytesDownloaded: z.number().nullable(),
  bytesTotal: z.number().nullable(),
  // Most-recent human-readable status line (last stdout/stderr chunk or
  // an installer-emitted message like "running brew install whisper-cpp").
  message: z.string(),
  // Set when state === "error".
  error: z.string().nullable(),
});
export type SttInstallProgress = z.infer<typeof SttInstallProgressSchema>;
