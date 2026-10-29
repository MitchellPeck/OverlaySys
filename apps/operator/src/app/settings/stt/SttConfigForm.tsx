"use client";

import { useMemo, useState, type ComponentProps, type ReactNode } from "react";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { useStore } from "@/lib/store";
import {
  LENGTH_OPTIONS_MS,
  PRESET_MODELS,
  STEP_OPTIONS_MS,
  buildSttCommand,
  type SttCaptureDevice,
  type SttInstallProgress,
  type SttModelFile,
  type SttSpawnerConfig,
} from "@overlaysys/core";
import { Button, Checkbox, Field, IconButton, Panel, Select, StatusDot, Textarea, colors } from "@overlaysys/ui";
import { Trash2 } from "lucide-react";
import { CaptureModeField, ChannelSelectFields } from "./ChannelSelect";
import { ProgressBar, humanBytes } from "./SttPresence";

export function SttConfigForm({
  draft,
  setDraft,
  send,
  confirm,
  models,
  modelsDir,
  installJobs,
  captureDevices,
  inputDevices,
  spawnerRunning,
  binaryPresent,
  serverBinaryMissing,
  onOpenCustom,
}: {
  draft: SttSpawnerConfig;
  setDraft: (next: SttSpawnerConfig) => void;
  send: (m: ClientMessage) => void;
  confirm: (o: { title?: string; message: ReactNode; confirmLabel?: string; destructive?: boolean }) => Promise<boolean>;
  models: SttModelFile[];
  modelsDir: string | null;
  installJobs: Record<string, SttInstallProgress>;
  captureDevices: SttCaptureDevice[];
  inputDevices: ComponentProps<typeof ChannelSelectFields>["inputDevices"];
  spawnerRunning: boolean;
  binaryPresent: boolean;
  serverBinaryMissing: boolean;
  onOpenCustom: () => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const usingCustom = draft.customCommand.trim().length > 0;
  const channelMode = draft.captureMode === "channels";
  const showCaptureMode = inputDevices !== null || channelMode;
  const commandPreview = useMemo(() => buildSttCommand(draft), [draft]);
  return (
    <Panel title="Configuration" padding="md">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Checkbox
          checked={draft.autoStart}
          onChange={(v) => setDraft({ ...draft, autoStart: v })}
          label="Auto-start on server boot"
        />
      </div>

      <ModelDropdown
        value={draft.modelPath}
        disabled={usingCustom}
        installedModels={models}
        modelsDir={modelsDir}
        installJobs={installJobs}
        onChange={(modelPath) => {
          setDraft({ ...draft, modelPath });
        }}
        onOpenCustom={onOpenCustom}
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
        spawnerRunning={spawnerRunning}
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

      {showCaptureMode && (
        <CaptureModeField draft={draft} setDraft={setDraft} disabled={usingCustom} />
      )}

      {channelMode ? (
        <ChannelSelectFields
          draft={draft}
          setDraft={setDraft}
          inputDevices={inputDevices}
          disabled={usingCustom}
          serverBinaryMissing={serverBinaryMissing}
        />
      ) : (
        <Field
          label={
            <span>
              Input device{" "}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => send({ type: "stt_enumerate_capture_devices", force: true })}
              >
                Rescan
              </Button>
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
      )}

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

    </Panel>
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
          variant="danger"
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
                    <StatusDot tone="good" label="Selected" style={{ marginLeft: 6 }} />
                  )}
                </div>
                <div style={{ fontSize: 10, color: colors.textDim, marginTop: 2 }}>
                  {m.sizeBytes != null ? humanBytes(m.sizeBytes) : "—"}
                </div>
              </div>
              <IconButton
                tone="danger"
                aria-label={`Delete model ${m.filename}`}
                disabled={blocked}
                title={
                  blocked
                    ? "Stop the spawner before deleting the model it's using"
                    : `Delete model ${m.filename}`
                }
                onClick={() => props.onDelete(m.filename, m.sizeBytes)}
              >
                <Trash2 size={14} aria-hidden />
              </IconButton>
            </div>
          );
        })}
      </div>
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
                <Button size="sm" variant="ghost" onClick={() => props.onCancel(j.jobId)}>
                  Cancel
                </Button>
              )}
            </div>
            <ProgressBar progress={j.progress} />
          </div>
        ))}
    </Field>
  );
}


function expandHomeClient(p: string): string {
  if (!p.startsWith("~")) return p;
  // The client doesn't know the home dir — just return the path verbatim;
  // server-side path matching handles tilde expansion.
  return p;
}

