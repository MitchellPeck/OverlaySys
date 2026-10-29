"use client";

import { Button, Panel, Pill, StatusDot, colors } from "@overlaysys/ui";
import type { SttInstallProgress } from "@overlaysys/core";

export const INSTALL_INSTRUCTIONS: Record<string, string> = {
  darwin: "brew install whisper-cpp",
  linux: "sudo apt-get install whisper.cpp  # or build from https://github.com/ggerganov/whisper.cpp",
  win32: "winget install ggerganov.whisper.cpp",
  other: "Build whisper.cpp from https://github.com/ggerganov/whisper.cpp",
};

export function SttPresencePanel(props: {
  view: "loading" | "present" | "missing";
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
  if (props.view === "loading") {
    return (
      <Panel title="Requirements" padding="md">
        <div role="status" aria-label="Checking requirements" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </Panel>
    );
  }
  return (
    <Panel title="Requirements" padding="md">
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
          {props.present ? (
            <StatusDot tone="good" label="Installed" />
          ) : (
            <Pill tone="bad">Missing</Pill>
          )}
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
              variant="danger"
              onClick={props.onDestructiveAction}
            >
              {props.destructiveActionLabel}
            </Button>
          )}
        {running && (
          <Button size="sm" variant="danger" onClick={props.onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}


export function ProgressBar({ progress }: { progress: number | null }) {
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


export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}


function SkeletonRow() {
  return (
    <div
      aria-hidden
      style={{
        height: 56,
        background: colors.panel2,
        border: `1px solid ${colors.border}`,
        borderRadius: 4,
        opacity: 0.6,
      }}
    />
  );
}
