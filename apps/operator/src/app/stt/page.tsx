"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PRESET_MODELS,
  STEP_OPTIONS_MS,
  LENGTH_OPTIONS_MS,
  buildSttCommand,
  type SttSpawnerConfig,
} from "@overlaysys/core";
import {
  Button,
  Field,
  Input,
  Modal,
  Panel,
  Pill,
  Select,
  Textarea,
  colors,
  type PillTone,
} from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useDialog } from "@/lib/dialog";
import { isCloudMode } from "@/lib/mode";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";

const STATE_TONES: Record<string, PillTone> = {
  idle: "dim",
  starting: "warn",
  running: "good",
  stopped: "dim",
  error: "bad",
};

const INSTALL_INSTRUCTIONS: Record<string, string> = {
  darwin: "brew install whisper-cpp",
  linux: "sudo apt-get install whisper.cpp  # or build from https://github.com/ggerganov/whisper.cpp",
  win32: "winget install ggerganov.whisper.cpp",
  other: "Build whisper.cpp from https://github.com/ggerganov/whisper.cpp",
};

export default function SttControlPage() {
  const router = useRouter();
  useEffect(() => {
    if (isCloudMode()) router.replace("/shows");
  }, [router]);
  if (isCloudMode()) return null;
  return <SttControlPageLocal />;
}

function SttControlPageLocal() {
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const status = useStore((s) => s.sttSpawnerStatus);
  const config = useStore((s) => s.sttSpawnerConfig);
  const presence = useStore((s) => s.sttPresence);
  const models = useStore((s) => s.sttModels);
  const modelsDir = useStore((s) => s.sttModelsDir);
  const captureDevices = useStore((s) => s.sttCaptureDevices);
  const installJobs = useStore((s) => s.sttInstallJobs);
  const { confirm, dialog } = useDialog();

  const [draft, setDraft] = useState<SttSpawnerConfig | null>(null);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Tracks a just-clicked Start/Stop so the button can flip to a disabled
  // "Starting…" / "Stopping…" state instantly, before the server's
  // stt_spawner_status broadcast arrives. Cleared by the effect below as
  // soon as the spawner reports a state consistent with the action having
  // landed (server moved through "starting"/"running" for a start, through
  // "stopped"/"idle" for a stop, or hit "error" either way).
  const [pendingAction, setPendingAction] = useState<"start" | "stop" | null>(
    null,
  );
  // Wall-clock time we entered the current pendingAction. Used to enforce a
  // minimum visible duration for the optimistic feedback — without this,
  // fast servers race through starting→running (or running→stopped) faster
  // than React can paint, the effect clears pendingAction immediately, and
  // the user never sees "Starting…" / "Stopping…" at all.
  const [pendingStartedAt, setPendingStartedAt] = useState<number>(0);

  // Boot-time fetch + presence refresh when the model selection changes
  // (so the "model installed?" banner reflects the dropdown choice live).
  useEffect(() => {
    if (conn !== "open") return;
    send({ type: "stt_spawner_get_config" });
    send({ type: "stt_check_presence" });
    send({ type: "stt_list_models" });
    // Intentionally NOT firing stt_enumerate_capture_devices here — that
    // probe spawns whisper-stream which loads ~500MB of backends AND opens
    // the default audio device. Doing it on every page mount blocks the
    // real spawner from acquiring the mic when the user clicks Start.
    // The Rescan button in the device dropdown triggers it explicitly with
    // force=true; otherwise the server returns its cache.
    send({ type: "stt_enumerate_capture_devices", force: false });
  }, [conn, send]);

  useEffect(() => {
    if (config && !draft) setDraft(config);
  }, [config, draft]);

  // Clear the pending Start/Stop indicator once the server's status moves
  // into the FINAL state for the user's action. Intermediate "starting" is
  // intentionally NOT a clear condition for start — otherwise a fast server
  // that flips starting→running between React paints would skip the
  // "Starting…" indicator entirely. The minimum-visible-duration guard
  // below also ensures the optimistic feedback shows even when the server
  // is faster than a single render commit. "error" is accepted as terminal
  // for both: if the spawn failed the user should see the error pill, not
  // a stuck "Starting…" button.
  useEffect(() => {
    if (!pendingAction || !status) return;
    const s = status.state;
    const matches =
      pendingAction === "start"
        ? s === "running" || s === "error"
        : s === "stopped" || s === "idle" || s === "error";
    if (!matches) return;
    // Minimum visible duration. Below this the optimistic state can look
    // like a flicker; above this the user has time to register the action
    // before the UI settles.
    const MIN_VISIBLE_MS = 400;
    const elapsed = Date.now() - pendingStartedAt;
    if (elapsed >= MIN_VISIBLE_MS) {
      setPendingAction(null);
    } else {
      const remaining = MIN_VISIBLE_MS - elapsed;
      const timer = setTimeout(() => setPendingAction(null), remaining);
      return () => clearTimeout(timer);
    }
  }, [pendingAction, pendingStartedAt, status]);

  // Fail-safe: if the spawner_status broadcast that would clear pendingAction
  // never arrives (server hang, WS hiccup, message ordering oddity), clear it
  // on a timer so the button doesn't get permanently stuck on "Stopping…".
  // 6 seconds is generous — start/stop normally round-trips in <100ms.
  useEffect(() => {
    if (!pendingAction) return;
    const t = setTimeout(() => setPendingAction(null), 6000);
    return () => clearTimeout(t);
  }, [pendingAction]);

  // Auto-clear terminal install/uninstall/download job entries after a short
  // delay. The server has already broadcast the refreshed `stt_presence` and
  // `stt_models` payloads by the time we receive a "done" tick (see
  // subscribeInstall in server/src/ws.ts), so the success/failure banner
  // doesn't need to linger forever — flash it for a few seconds, then prune
  // so the progress card disappears.
  useEffect(() => {
    const clearJob = useStore.getState().clearSttInstallJob;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const job of Object.values(installJobs)) {
      if (
        job.state === "done" ||
        job.state === "error" ||
        job.state === "cancelled"
      ) {
        timers.push(setTimeout(() => clearJob(job.jobId), 4000));
      }
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [installJobs]);

  // useMemo must run on every render so the hook order is stable — keep it
  // ABOVE the early return for the loading state. Pass through a non-null
  // placeholder when draft hasn't loaded yet; commandPreview is only read
  // after the !draft guard so the value-shape during loading is irrelevant.
  const commandPreview = useMemo(
    () => (draft ? buildSttCommand(draft) : ""),
    [draft],
  );

  if (!draft) {
    return (
      <>
        <PageChrome />
        <PageBody style={{ height: "100%" }}>Loading…</PageBody>
      </>
    );
  }

  function save(next: SttSpawnerConfig = draft!) {
    // The server re-checks presence inline as part of the save_config
    // handler and broadcasts the result, so we don't fire a separate
    // stt_check_presence here (doing so would race the save's disk write).
    send({ type: "stt_spawner_save_config", config: next });
  }
  function start() {
    setPendingAction("start");
    setPendingStartedAt(Date.now());
    // Pass the current draft so the server saves and starts atomically in
    // one handler — without this, save_config and start are two concurrent
    // async handlers and start can launch with stale on-disk config. The
    // non-null assertion is safe: the !draft early-return above guarantees
    // we never reach here while draft is unset (TS just doesn't carry the
    // narrowing into nested function closures).
    send({ type: "stt_spawner_start", config: draft! });
  }
  function stop() {
    setPendingAction("stop");
    setPendingStartedAt(Date.now());
    send({ type: "stt_spawner_stop" });
  }

  const state = status?.state ?? "idle";
  // While Start/Stop is pending the pill needs to look "in-flight" too —
  // not green/red for the about-to-change state, but warn-yellow until the
  // server confirms. Without this, the text says "stopping" but the
  // background stays running-green which reads as broken to the user.
  const tone: PillTone = pendingAction
    ? "warn"
    : STATE_TONES[state] ?? "dim";

  const binaryPresent = presence?.binary.path != null;
  const modelPresent = presence?.selectedModel.present ?? false;
  const binaryJob = installJobs["binary"];
  const selectedModelFilename = presence?.selectedModel.filename ?? "";
  const modelJob = selectedModelFilename ? installJobs[selectedModelFilename] : undefined;

  const usingCustom = draft.customCommand.trim().length > 0;

  return (
    <>
      <PageChrome
        title="STT Spawner"
        actions={
          <>
            <Pill tone={tone} uppercase>
              {pendingAction === "start"
                ? "starting"
                : pendingAction === "stop"
                ? "stopping"
                : state}
            </Pill>
            {pendingAction === "start" ? (
              <Button disabled variant="primary" size="sm">
                Starting…
              </Button>
            ) : pendingAction === "stop" ? (
              <Button disabled variant="destructive" size="sm">
                Stopping…
              </Button>
            ) : state === "running" || state === "starting" ? (
              <Button onClick={stop} variant="destructive" size="sm">
                Stop
              </Button>
            ) : (
              <Button
                onClick={start}
                variant="primary"
                size="sm"
                disabled={!binaryPresent || !modelPresent}
                title={
                  !binaryPresent
                    ? "whisper-stream is not installed"
                    : !modelPresent
                    ? "Selected model file is missing"
                    : undefined
                }
              >
                Start
              </Button>
            )}
          </>
        }
      />
      <PageBody maxWidth={1000} style={{ height: "100%" }}>
        <PresencePanel
          binaryPresent={binaryPresent}
          binaryPath={presence?.binary.path ?? null}
          binaryVersion={presence?.binary.version ?? null}
          packageManager={presence?.packageManager ?? null}
          platform={presence?.platform ?? "other"}
          modelPresent={modelPresent}
          modelPath={presence?.selectedModel.path ?? draft.modelPath}
          modelSize={presence?.selectedModel.sizeBytes ?? null}
          modelJob={modelJob}
          binaryJob={binaryJob}
          spawnerRunning={state === "running" || state === "starting"}
          onInstallBinary={() => {
            // Optimistic: post a pending entry locally so the button flips
            // to Cancel + indeterminate progress instantly. The server's
            // first "running" tick (and every subsequent progress tick)
            // overwrites this entry, so it's a transient placeholder.
            useStore.getState().setSttInstallProgress({
              jobId: "binary",
              state: "pending",
              progress: null,
              bytesDownloaded: null,
              bytesTotal: null,
              message: `Requesting ${presence?.packageManager ?? "package manager"} install…`,
              error: null,
            });
            send({ type: "stt_install_binary" });
          }}
          onUninstallBinary={async () => {
            const ok = await confirm({
              title: "Uninstall whisper-cpp?",
              message:
                "This runs the package manager's uninstall command and removes whisper-stream from your system. Downloaded model files are kept.",
              confirmLabel: "Uninstall",
              destructive: true,
            });
            if (!ok) return;
            useStore.getState().setSttInstallProgress({
              jobId: "binary",
              state: "pending",
              progress: null,
              bytesDownloaded: null,
              bytesTotal: null,
              message: `Requesting ${presence?.packageManager ?? "package manager"} uninstall…`,
              error: null,
            });
            send({ type: "stt_uninstall_binary" });
          }}
          onCancel={(jobId) => send({ type: "stt_cancel_install", jobId })}
        />

        <Panel title="Configuration" padding="md" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <input
              type="checkbox"
              id="autoStart"
              checked={draft.autoStart}
              onChange={(e) => setDraft({ ...draft, autoStart: e.target.checked })}
            />
            <label htmlFor="autoStart" style={{ fontSize: 13 }}>
              Auto-start on server boot
            </label>
          </div>

          <ModelDropdown
            value={draft.modelPath}
            disabled={usingCustom}
            installedModels={models}
            modelsDir={modelsDir}
            installJobs={installJobs}
            onChange={(modelPath) => {
              const next = { ...draft, modelPath };
              setDraft(next);
              save(next);
            }}
            onOpenCustom={() => setCustomModalOpen(true)}
            onCancel={(jobId) => send({ type: "stt_cancel_install", jobId })}
          />

          <SelectedModelInstaller
            modelPath={draft.modelPath}
            installedModels={models}
            installJobs={installJobs}
            onInstall={(preset) => {
              // Optimistic placeholder so the Install button switches to
              // Cancel + indeterminate progress on click, without waiting
              // for the server's first running broadcast. Server progress
              // events overwrite this entry as soon as they arrive.
              useStore.getState().setSttInstallProgress({
                jobId: preset.filename,
                state: "pending",
                progress: null,
                bytesDownloaded: 0,
                bytesTotal: preset.sizeBytes,
                message: `Requesting download of ${preset.name}…`,
                error: null,
              });
              send({
                type: "stt_download_model",
                url: preset.url,
                filename: preset.filename,
              });
            }}
            onCancel={(jobId) => send({ type: "stt_cancel_install", jobId })}
          />

          <InstalledModelsList
            models={models}
            selectedModelPath={draft.modelPath}
            spawnerRunning={state === "running" || state === "starting"}
            onDelete={async (filename, size) => {
              const ok = await confirm({
                title: "Delete model file?",
                message: (
                  <>
                    Permanently delete <code>{filename}</code>
                    {size ? ` (${humanBytes(size)})` : ""} from your models
                    directory? You can re-download it any time from the model
                    dropdown.
                  </>
                ),
                confirmLabel: "Delete",
                destructive: true,
              });
              if (ok) send({ type: "stt_delete_model", filename });
            }}
          />

          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            <div style={{ flex: 1 }}>
              <Field
                label="Step (inference cadence)"
                hint="Lower = more responsive, higher CPU. Default 500."
              >
                <Select
                  value={String(draft.stepMs)}
                  disabled={usingCustom}
                  onChange={(e) =>
                    setDraft({ ...draft, stepMs: Number(e.target.value) })
                  }
                >
                  {STEP_OPTIONS_MS.map((ms) => (
                    <option key={ms} value={ms}>
                      {ms} ms
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field
                label="Length (sliding window)"
                hint="Larger = more context per inference. Default 5000."
              >
                <Select
                  value={String(draft.lengthMs)}
                  disabled={usingCustom}
                  onChange={(e) =>
                    setDraft({ ...draft, lengthMs: Number(e.target.value) })
                  }
                >
                  {LENGTH_OPTIONS_MS.map((ms) => (
                    <option key={ms} value={ms}>
                      {ms} ms
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>

          <Field
            label={
              <span>
                Input device{" "}
                <button
                  onClick={() =>
                    send({
                      type: "stt_enumerate_capture_devices",
                      force: true,
                    })
                  }
                  style={{
                    background: "transparent",
                    border: "none",
                    color: colors.textDim,
                    cursor: "pointer",
                    fontSize: 11,
                    padding: 0,
                    marginLeft: 6,
                    textDecoration: "underline",
                  }}
                >
                  rescan
                </button>
              </span>
            }
            hint={
              captureDevices.length <= 1 && !binaryPresent
                ? "Install whisper-stream to enumerate audio inputs."
                : "Devices listed in the same order whisper-stream sees them."
            }
          >
            <Select
              value={String(draft.captureDevice)}
              disabled={usingCustom}
              onChange={(e) =>
                setDraft({ ...draft, captureDevice: Number(e.target.value) })
              }
            >
              {captureDevices.length === 0 ? (
                <option value="-1">System default</option>
              ) : (
                captureDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.id === -1 ? d.name : `#${d.id} — ${d.name}`}
                  </option>
                ))
              )}
            </Select>
          </Field>

          <details
            open={showAdvanced || usingCustom}
            onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
            style={{ marginTop: 16 }}
          >
            <summary
              style={{
                cursor: "pointer",
                fontSize: 12,
                color: colors.textDim,
                userSelect: "none",
              }}
            >
              Advanced: custom command override
            </summary>
            <p
              style={{
                fontSize: 11,
                color: colors.textDim,
                lineHeight: 1.5,
                marginTop: 6,
                marginBottom: 6,
              }}
            >
              Use this to bypass the structured fields and run any shell pipeline
              that writes transcribed text to stdout — e.g. a cloud STT bridge
              or your own wrapper.
            </p>
            <Textarea
              value={draft.customCommand}
              onChange={(e) => setDraft({ ...draft, customCommand: e.target.value })}
              rows={3}
              mono
              placeholder="(empty — use structured fields above)"
            />
          </details>

          <div style={{ marginTop: 12 }}>
            <Field label="Command that will be run" hint="Stdout is piped into the lyric-listener daemon.">
              <pre
                style={{
                  margin: 0,
                  padding: 8,
                  fontSize: 11,
                  background: colors.panel2,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 4,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  color: colors.textDim,
                }}
              >
                {commandPreview}
              </pre>
            </Field>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <Button onClick={() => save()} size="sm">
              Save Config
            </Button>
          </div>
        </Panel>

        <Panel
          title={`Recent logs ${status?.pid ? `(pid ${status.pid})` : ""}`}
          padding="md"
        >
          {status?.lastError && (
            <div
              style={{
                padding: 8,
                marginBottom: 8,
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: 4,
                fontSize: 12,
                color: colors.errorText,
              }}
            >
              {status.lastError}
            </div>
          )}
          <pre
            style={{
              background: colors.panel2,
              padding: 12,
              borderRadius: 4,
              fontSize: 11,
              fontFamily: "ui-monospace, monospace",
              maxHeight: 400,
              overflow: "auto",
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {(status?.recentLogs ?? []).join("\n") || "(no logs yet)"}
          </pre>
        </Panel>
      </PageBody>

      <CustomModelModal
        open={customModalOpen}
        onClose={() => setCustomModalOpen(false)}
        onSubmit={(url, filename) => {
          send({ type: "stt_download_model", url, filename });
          setCustomModalOpen(false);
        }}
        installPlaceholder={INSTALL_INSTRUCTIONS[presence?.platform ?? "other"]}
      />
      {dialog}
    </>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function PresencePanel(props: {
  binaryPresent: boolean;
  binaryPath: string | null;
  binaryVersion: string | null;
  packageManager: string | null;
  platform: string;
  modelPresent: boolean;
  modelPath: string;
  modelSize: number | null;
  modelJob: import("@overlaysys/core").SttInstallProgress | undefined;
  binaryJob: import("@overlaysys/core").SttInstallProgress | undefined;
  spawnerRunning: boolean;
  onInstallBinary: () => void;
  onUninstallBinary: () => void;
  onCancel: (jobId: string) => void;
}) {
  const allGood = props.binaryPresent && props.modelPresent;
  return (
    <Panel
      title="STT Requirements"
      padding="md"
      style={{ marginBottom: 16 }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <RequirementRow
          label="whisper-stream binary"
          present={props.binaryPresent}
          detail={
            props.binaryPresent
              ? props.binaryPath ?? "installed"
              : `Not installed (${INSTALL_INSTRUCTIONS[props.platform] ?? INSTALL_INSTRUCTIONS["other"]})`
          }
          job={props.binaryJob}
          actionLabel={
            props.packageManager
              ? `Install via ${props.packageManager}`
              : null
          }
          onAction={props.onInstallBinary}
          onCancel={() => props.onCancel("binary")}
          destructiveActionLabel={
            props.packageManager && !props.spawnerRunning
              ? `Uninstall via ${props.packageManager}`
              : undefined
          }
          onDestructiveAction={
            props.packageManager && !props.spawnerRunning
              ? props.onUninstallBinary
              : undefined
          }
          hint={
            props.binaryPresent && props.spawnerRunning
              ? "Stop the spawner before uninstalling."
              : undefined
          }
        />
        <RequirementRow
          label="Whisper model"
          present={props.modelPresent}
          detail={
            props.modelPresent
              ? `${props.modelPath}${props.modelSize ? ` (${humanBytes(props.modelSize)})` : ""}`
              : `Missing: ${props.modelPath}`
          }
          job={props.modelJob}
          actionLabel={null}
          onAction={() => {}}
          onCancel={() => props.modelJob && props.onCancel(props.modelJob.jobId)}
          hint={!props.modelPresent ? "Pick a preset below to install." : undefined}
        />
      </div>
      {allGood && (
        <p style={{ fontSize: 11, color: colors.green, marginTop: 10, marginBottom: 0 }}>
          All requirements installed — ready to start STT.
        </p>
      )}
    </Panel>
  );
}

function RequirementRow(props: {
  label: string;
  present: boolean;
  detail: string;
  hint?: string;
  job: import("@overlaysys/core").SttInstallProgress | undefined;
  actionLabel: string | null;
  onAction: () => void;
  onCancel: () => void;
  // When `present` is true and these are provided, render a destructive
  // secondary action button (e.g. "Uninstall") instead of the install button.
  destructiveActionLabel?: string;
  onDestructiveAction?: () => void;
}) {
  const j = props.job;
  const running = j && (j.state === "running" || j.state === "pending");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        padding: 10,
        background: colors.panel2,
        border: `1px solid ${colors.border}`,
        borderRadius: 4,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Pill tone={props.present ? "good" : "bad"}>
            {props.present ? "Installed" : "Missing"}
          </Pill>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{props.label}</span>
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: colors.textDim,
            fontFamily: "ui-monospace, monospace",
            wordBreak: "break-all",
          }}
        >
          {props.detail}
        </div>
        {props.hint && (
          <div style={{ marginTop: 4, fontSize: 11, color: colors.textDim }}>
            {props.hint}
          </div>
        )}
        {j && (
          <div style={{ marginTop: 6 }}>
            <ProgressBar progress={j.progress} />
            <div style={{ fontSize: 11, color: colors.textDim, marginTop: 3 }}>
              {j.message}
              {j.state === "error" && j.error && (
                <span style={{ color: colors.errorText }}> — {j.error}</span>
              )}
            </div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {!props.present && props.actionLabel && !running && (
          <Button size="sm" onClick={props.onAction}>
            {props.actionLabel}
          </Button>
        )}
        {props.present &&
          !running &&
          props.destructiveActionLabel &&
          props.onDestructiveAction && (
            <Button
              size="sm"
              variant="destructive"
              onClick={props.onDestructiveAction}
            >
              {props.destructiveActionLabel}
            </Button>
          )}
        {running && (
          <Button size="sm" variant="destructive" onClick={props.onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function SelectedModelInstaller(props: {
  modelPath: string;
  installedModels: import("@overlaysys/core").SttModelFile[];
  installJobs: Record<string, import("@overlaysys/core").SttInstallProgress>;
  onInstall: (preset: (typeof PRESET_MODELS)[number]) => void;
  onCancel: (jobId: string) => void;
}) {
  // Match the dropdown's missing-preset detection: if modelPath ends with a
  // known preset filename and the file isn't on disk, surface an explicit
  // Install button. Selection alone never triggers a download — the user
  // has to click through.
  //
  // Crucially, derive "is it installed?" from the local installedModels list
  // rather than from the server's presence payload — presence is keyed off
  // the LAST saved modelPath, so when the user picks a new preset there's a
  // round-trip lag (save_config → check_presence → stt_presence broadcast)
  // before presence reflects the new choice. The models list updates the
  // moment the user opens the page and stays current as downloads finish,
  // so a basename comparison here gives the install button instantly.
  const selectedPreset = PRESET_MODELS.find(
    (p) =>
      props.modelPath.endsWith(`/${p.filename}`) ||
      props.modelPath === p.filename,
  );
  if (!selectedPreset) return null;
  const installedLocally = props.installedModels.some(
    (m) => m.present && m.filename === selectedPreset.filename,
  );
  if (installedLocally) return null;

  // The download job is keyed by filename — pull it out of the install-jobs
  // map directly rather than going through presence.selectedModel.filename,
  // for the same staleness reason above.
  const job = props.installJobs[selectedPreset.filename];
  const running = job && (job.state === "running" || job.state === "pending");

  return (
    <div
      style={{
        marginTop: 8,
        padding: 10,
        background: colors.panel2,
        border: `1px solid ${colors.border}`,
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500 }}>
          {selectedPreset.name} is not installed
        </div>
        <div
          style={{
            fontSize: 11,
            color: colors.textDim,
            marginTop: 2,
            fontFamily: "ui-monospace, monospace",
            wordBreak: "break-all",
          }}
        >
          {selectedPreset.filename} ·{" "}
          {humanBytes(selectedPreset.sizeBytes)} approx
        </div>
        {job && (
          <div style={{ marginTop: 6 }}>
            <ProgressBar progress={job.progress} />
            <div style={{ fontSize: 11, color: colors.textDim, marginTop: 3 }}>
              {job.message}
              {job.state === "error" && job.error && (
                <span style={{ color: colors.errorText }}> — {job.error}</span>
              )}
            </div>
          </div>
        )}
      </div>
      {running ? (
        <Button
          size="sm"
          variant="destructive"
          onClick={() => job && props.onCancel(job.jobId)}
        >
          Cancel
        </Button>
      ) : (
        <Button
          size="sm"
          variant="primary"
          onClick={() => props.onInstall(selectedPreset)}
        >
          Install {selectedPreset.id}
        </Button>
      )}
    </div>
  );
}

function InstalledModelsList(props: {
  models: import("@overlaysys/core").SttModelFile[];
  selectedModelPath: string;
  spawnerRunning: boolean;
  onDelete: (filename: string, size: number | null) => void;
}) {
  const installed = props.models.filter((m) => m.present);
  if (installed.length === 0) return null;
  // Match the dropdown's "selected" semantics — the path the spawner will
  // launch with, after tilde expansion. The browser doesn't know HOME so we
  // fall back to a basename comparison if the value is tilde-prefixed.
  function isSelected(modelPath: string): boolean {
    if (props.selectedModelPath === modelPath) return true;
    if (props.selectedModelPath.startsWith("~")) {
      const base = props.selectedModelPath.split("/").pop();
      return modelPath.endsWith(`/${base}`);
    }
    return false;
  }
  return (
    <div style={{ marginTop: 4, marginBottom: 8 }}>
      <div
        style={{
          fontSize: 11,
          color: colors.textDim,
          marginBottom: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>Installed models ({installed.length})</span>
      </div>
      <div
        style={{
          border: `1px solid ${colors.border}`,
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        {installed.map((m, i) => {
          const selected = isSelected(m.path);
          const blocked = selected && props.spawnerRunning;
          return (
            <div
              key={m.path}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 10px",
                background: colors.panel2,
                borderTop: i === 0 ? "none" : `1px solid ${colors.border}`,
                fontSize: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    wordBreak: "break-all",
                    color: selected ? colors.text : colors.textDim,
                    fontWeight: selected ? 500 : 400,
                  }}
                >
                  {m.filename}
                  {selected && (
                    <Pill tone="good" style={{ marginLeft: 6 }}>
                      Selected
                    </Pill>
                  )}
                </div>
                <div style={{ fontSize: 10, color: colors.textDim, marginTop: 2 }}>
                  {m.sizeBytes != null ? humanBytes(m.sizeBytes) : "—"}
                </div>
              </div>
              <Button
                size="sm"
                variant="destructive"
                disabled={blocked}
                title={
                  blocked
                    ? "Stop the spawner before deleting the model it's using"
                    : undefined
                }
                onClick={() => props.onDelete(m.filename, m.sizeBytes)}
              >
                Delete
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProgressBar({ progress }: { progress: number | null }) {
  const pct = progress != null ? Math.max(0, Math.min(1, progress)) : null;
  return (
    <div
      style={{
        height: 4,
        background: colors.border,
        borderRadius: 2,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          height: "100%",
          width: pct == null ? "33%" : `${pct * 100}%`,
          background: colors.green,
          transition: "width 200ms",
          // Indeterminate state: a soft gradient hint so users know something
          // is moving even before the first content-length-derived percentage.
          opacity: pct == null ? 0.4 : 1,
        }}
      />
    </div>
  );
}

function ModelDropdown(props: {
  value: string;
  disabled: boolean;
  installedModels: import("@overlaysys/core").SttModelFile[];
  modelsDir: string | null;
  installJobs: Record<string, import("@overlaysys/core").SttInstallProgress>;
  onChange: (modelPath: string) => void;
  onOpenCustom: () => void;
  onCancel: (jobId: string) => void;
}) {
  const SENTINEL_CUSTOM = "__custom__";
  // Build an option list combining: installed .bin files in models dir, the
  // presets that AREN'T installed yet (shown as "(not installed)"), and a
  // sentinel for "Install from URL…" which opens a modal. Picking any
  // option only updates the selection — installation is gated behind an
  // explicit Install button in the parent so nothing downloads without the
  // user clicking through.
  const installed = props.installedModels.filter((m) => m.present);
  const missingPresets = PRESET_MODELS.filter(
    (preset) =>
      !installed.some((m) => m.filename === preset.filename),
  );

  // The dropdown's "selected" option matches by file path (for installed
  // models) OR by preset filename (for not-yet-downloaded presets the user
  // has chosen). Falling all the way through to "__external__" means the
  // user pointed modelPath somewhere we don't recognise — e.g. a hand-typed
  // path or a custom-downloaded model that vanished from disk.
  const valueOnDisk = installed.find(
    (m) => m.path === expandHomeClient(props.value) || m.path === props.value,
  );
  const matchingMissingPreset = !valueOnDisk
    ? missingPresets.find(
        (p) =>
          props.value.endsWith(`/${p.filename}`) || props.value === p.filename,
      )
    : undefined;

  const selectValue = valueOnDisk
    ? valueOnDisk.path
    : matchingMissingPreset
    ? matchingMissingPreset.filename
    : "__external__";

  return (
    <Field
      label="Whisper model"
      hint={
        props.modelsDir
          ? `Drop .bin files in ${props.modelsDir} to add custom models.`
          : undefined
      }
    >
      <div style={{ display: "flex", gap: 6 }}>
        <Select
          value={selectValue}
          disabled={props.disabled}
          onChange={(e) => {
            const v = e.target.value;
            if (v === SENTINEL_CUSTOM) {
              props.onOpenCustom();
              return;
            }
            // Picking a missing preset just records the user's intent in
            // modelPath — no download fires here. The parent renders an
            // explicit "Install" button below the dropdown when the
            // selected model isn't on disk.
            const preset = PRESET_MODELS.find((p) => p.filename === v);
            if (preset) {
              props.onChange(
                `${props.modelsDir ?? "~/whisper-models"}/${preset.filename}`,
              );
              return;
            }
            props.onChange(v);
          }}
        >
          {installed.length > 0 && (
            <optgroup label="Installed">
              {installed.map((m) => (
                <option key={m.path} value={m.path}>
                  {m.filename}{" "}
                  {m.sizeBytes ? `(${humanBytes(m.sizeBytes)})` : ""}
                </option>
              ))}
            </optgroup>
          )}
          {missingPresets.length > 0 && (
            <optgroup label="Available presets (not installed)">
              {missingPresets.map((preset) => (
                <option key={preset.filename} value={preset.filename}>
                  {preset.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Custom">
            <option value={SENTINEL_CUSTOM}>Install from URL…</option>
          </optgroup>
          {!valueOnDisk && !matchingMissingPreset && (
            <option value="__external__" disabled>
              External: {props.value}
            </option>
          )}
        </Select>
      </div>
      {Object.values(props.installJobs)
        .filter((j) => j.jobId !== "binary")
        .map((j) => (
          <div
            key={j.jobId}
            style={{
              marginTop: 6,
              fontSize: 11,
              color: colors.textDim,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>
                {j.jobId} — {j.message}
              </span>
              {(j.state === "running" || j.state === "pending") && (
                <button
                  onClick={() => props.onCancel(j.jobId)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: colors.errorText,
                    cursor: "pointer",
                    fontSize: 11,
                    padding: 0,
                  }}
                >
                  cancel
                </button>
              )}
            </div>
            <ProgressBar progress={j.progress} />
          </div>
        ))}
    </Field>
  );
}

function CustomModelModal(props: {
  open: boolean;
  onClose: () => void;
  onSubmit: (url: string, filename: string) => void;
  installPlaceholder: string | undefined;
}) {
  const [url, setUrl] = useState("");
  const [filename, setFilename] = useState("");

  useEffect(() => {
    if (!props.open) {
      setUrl("");
      setFilename("");
    }
  }, [props.open]);

  // Auto-derive filename from the URL's last path segment when the user
  // hasn't customised it — most HuggingFace URLs end in ggml-*.bin so
  // this is usually exactly right.
  useEffect(() => {
    if (filename) return;
    try {
      const u = new URL(url);
      const last = u.pathname.split("/").pop() ?? "";
      if (last.endsWith(".bin")) setFilename(last);
    } catch {
      // ignore — user is still typing
    }
  }, [url, filename]);

  const valid = url.length > 0 && filename.endsWith(".bin") && !filename.includes("/");

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Install custom model"
      size="md"
      onConfirm={() => valid && props.onSubmit(url, filename)}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => props.onSubmit(url, filename)}
          >
            Download
          </Button>
        </>
      }
    >
      <Field
        label="Model URL"
        hint={
          <>
            HuggingFace, S3, or any direct .bin download. Browse models at{" "}
            <code>huggingface.co/ggerganov/whisper.cpp</code>.
          </>
        }
      >
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/ggml-custom.bin"
          autoFocus
        />
      </Field>
      <Field
        label="Filename"
        hint="Saved into the models directory under this name. Must end in .bin."
      >
        <Input
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="ggml-custom.bin"
        />
      </Field>
    </Modal>
  );
}

function expandHomeClient(p: string): string {
  if (!p.startsWith("~")) return p;
  // The client doesn't know the home dir — just return the path verbatim;
  // server-side path matching handles tilde expansion.
  return p;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
