"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { type SttSpawnerConfig } from "@overlaysys/core";
import {
  Button,
  Field,
  Input,
  Modal,
  Panel,
  Pill,
  SaveBar,
  StatusDot,
  colors,
  type PillTone,
} from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { channelSelectProblem } from "@/lib/sttChannels";
import { getClient, useWs } from "@/lib/useWs";
import { requestOne, sendAndAwaitAck } from "@/lib/awaitAck";
import { useDialog } from "@/lib/dialog";
import { isCloudMode } from "@/lib/mode";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { useSettingsDraft } from "../useSettingsDraft";
import { SttConfigForm } from "./SttConfigForm";
import { INSTALL_INSTRUCTIONS, SttPresencePanel } from "./SttPresence";
import { presenceView, sttConfigEqual } from "./sttDraft";

const STATE_TONES: Record<string, PillTone> = {
  idle: "dim",
  starting: "warn",
  running: "good",
  stopped: "dim",
  error: "bad",
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
  const presence = useStore((s) => s.sttPresence);
  const models = useStore((s) => s.sttModels);
  const modelsDir = useStore((s) => s.sttModelsDir);
  const captureDevices = useStore((s) => s.sttCaptureDevices);
  const inputDevices = useStore((s) => s.sttInputDevices);
  const installJobs = useStore((s) => s.sttInstallJobs);
  const { confirm, dialog } = useDialog();

  const [customModalOpen, setCustomModalOpen] = useState(false);
  const {
    value: draft,
    set: setDraft,
    bar,
    error: draftError,
    reload,
  } = useSettingsDraft<SttSpawnerConfig>({
    load: () =>
      requestOne(
        getClient(),
        { type: "stt_spawner_get_config" },
        (m) => (m.type === "stt_spawner_config" ? m.config : undefined),
      ),
    async save(next) {
      await sendAndAwaitAck(getClient(), { type: "stt_spawner_save_config", config: next }, { op: "stt_spawner_save_config" });
      return next;
    },
    equal: sttConfigEqual,
    validate: (v) => channelSelectProblem(v, inputDevices),
  });
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

  // The draft's first load can run before the socket is open; retry on connect.
  useEffect(() => {
    if (conn === "open" && !draft) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn]);

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

  if (!draft) {
    return (
      <>
        <PageChrome title="Speech-to-text" actions={<SaveBar {...bar} />} />
        <PageBody variant="wide">
          {draftError ? (
            <p role="alert" style={{ color: colors.errorText, fontSize: 12, margin: 0 }}>
              {draftError}
            </p>
          ) : (
            <p style={{ fontSize: 13, color: colors.textDim, margin: 0 }}>Loading…</p>
          )}
        </PageBody>
      </>
    );
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

  const statusLabel =
    pendingAction === "start" ? "starting" : pendingAction === "stop" ? "stopping" : state;

  const channelMode = draft.captureMode === "channels";
  const channelProblem = channelSelectProblem(draft, inputDevices);
  const serverBinaryMissing = channelMode && presence?.serverBinary?.path == null;
  const binaryPresent = presence?.binary.path != null;
  const modelPresent = presence?.selectedModel.present ?? false;
  const binaryJob = installJobs["binary"];
  const selectedModelFilename = presence?.selectedModel.filename ?? "";
  const modelJob = selectedModelFilename ? installJobs[selectedModelFilename] : undefined;

  const view = presenceView(presence);

  return (
    <>
      <PageChrome
        title="Speech-to-text"
        actions={
          <>
            <SaveBar {...bar} />
            {tone === "warn" || tone === "bad" || tone === "live" ? (
              <Pill tone={tone}>{statusLabel}</Pill>
            ) : (
              <StatusDot tone={tone} label={statusLabel} />
            )}
            {pendingAction === "start" ? (
              <Button disabled variant="primary" size="sm">
                Starting…
              </Button>
            ) : pendingAction === "stop" ? (
              <Button disabled variant="danger" size="sm">
                Stopping…
              </Button>
            ) : state === "running" || state === "starting" ? (
              <Button onClick={stop} variant="danger" size="sm">
                Stop
              </Button>
            ) : (
              <Button
                onClick={start}
                variant="primary"
                size="sm"
                disabled={
                  view !== "present" || bar.dirty || channelProblem !== null || serverBinaryMissing
                }
                title={
                  view === "loading"
                    ? "Checking requirements…"
                    : bar.dirty
                    ? "Save your changes before starting"
                    : !binaryPresent
                    ? "whisper-stream is not installed"
                    : !modelPresent
                    ? "Selected model file is missing"
                    : serverBinaryMissing
                    ? "whisper-server is not installed"
                    : channelProblem ?? undefined
                }
              >
                Start
              </Button>
            )}
          </>
        }
      />
      <PageBody variant="wide">
        {draftError && (
          <p role="alert" style={{ color: colors.errorText, fontSize: 12, margin: 0 }}>
            {draftError}
          </p>
        )}
        <SttPresencePanel
          view={view}
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


        <SttConfigForm
          draft={draft}
          setDraft={setDraft}
          send={send}
          confirm={confirm}
          models={models}
          modelsDir={modelsDir}
          installJobs={installJobs}
          captureDevices={captureDevices}
          inputDevices={inputDevices}
          spawnerRunning={state === "running" || state === "starting"}
          binaryPresent={binaryPresent}
          serverBinaryMissing={serverBinaryMissing}
          onOpenCustom={() => setCustomModalOpen(true)}
        />

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
