import { z } from "zod";

export const SttSpawnerConfigSchema = z.object({
  // When true, the server starts the spawner automatically on boot.
  autoStart: z.boolean().default(false),

  // The shell command used to spawn the STT process. The output is piped
  // into the lyric-listener stdin daemon. Default is whisper-stream with
  // base.en model. Users can edit freely (e.g. swap whisper for a cloud
  // STT bash wrapper).
  command: z
    .string()
    .default(
      "whisper-stream -m ~/whisper-models/ggml-base.en.bin --step 500 --length 5000",
    ),
});
export type SttSpawnerConfig = z.infer<typeof SttSpawnerConfigSchema>;

export const DEFAULT_STT_SPAWNER_CONFIG: SttSpawnerConfig = {
  autoStart: false,
  command:
    "whisper-stream -m ~/whisper-models/ggml-base.en.bin --step 500 --length 5000",
};

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
