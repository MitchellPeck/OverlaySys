"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Field,
  Inline,
  Panel,
  Pill,
  Stack,
  colors,
} from "@overlaysys/ui";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import {
  connectOvation,
  disconnectOvation,
  getOvationConnection,
  getSyncStatus,
  runSyncNow,
  type OvationConnectionStatus,
  type OvationSyncStatus,
} from "../../lib/ovationClient";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  background: colors.surface2,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  borderRadius: 4,
  fontSize: 14,
};

/**
 * Ovation connector.
 *
 * Ovation is where the show is authored — a Run of Show with graphics attached
 * to its cues. Connecting here lets this machine pull those shows down into its
 * local replica, where the operator takes them on air as usual.
 *
 * The operator key is issued in Ovation (workspace settings → OverlaySys) and
 * is scoped to a single workspace. It is sent to this machine's own server and
 * never displayed again.
 */
export default function OvationPage() {
  const [connection, setConnection] = useState<OvationConnectionStatus | null>(null);
  const [sync, setSync] = useState<OvationSyncStatus | null>(null);

  const [baseUrl, setBaseUrl] = useState("https://api.ovation-os.com");
  const [workspaceId, setWorkspaceId] = useState("");
  const [operatorKey, setOperatorKey] = useState("");

  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [conn, status] = await Promise.all([getOvationConnection(), getSyncStatus()]);
      setConnection(conn);
      setSync(status);
      if (conn.baseUrl) setBaseUrl(conn.baseUrl);
      if (conn.workspaceId) setWorkspaceId(conn.workspaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Reflect the background sync loop without the operator reloading.
    const id = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await connectOvation({
        baseUrl: baseUrl.trim(),
        operatorKey: operatorKey.trim(),
        workspaceId: workspaceId.trim(),
      });
      if (!result.ok) {
        setError(result.error ?? "Connection failed");
        return;
      }
      setOperatorKey("");
      setNotice(`Connected to ${result.workspaceName ?? "the workspace"}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }, [baseUrl, operatorKey, workspaceId, refresh]);

  const disconnect = useCallback(async () => {
    setError(null);
    setNotice(null);
    try {
      await disconnectOvation();
      setNotice("Disconnected. Shows already synced stay on this machine.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [refresh]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await runSyncNow();
      setNotice(
        result
          ? `Synced — pulled ${result.pulled}, pushed ${result.pushed}`
          : "Not connected, nothing to sync",
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  const connected = !!connection?.connected;

  return (
    <>
      <PageChrome title="Ovation" />
      <PageBody maxWidth={1000}>
        <Stack gap={4}>

      {error && (
        <div
          style={{
            color: colors.danger,
            border: `1px solid ${colors.danger}`,
            borderRadius: 4,
            padding: "8px 10px",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
      {notice && <div style={{ color: colors.textDim, fontSize: 13 }}>{notice}</div>}

      <Panel title="Connection">
        <Stack gap={3}>
          <Inline gap={2}>
            <Pill tone={connected ? "good" : "neutral"}>
              {connected ? "Connected" : "Not connected"}
            </Pill>
            {connection?.workspaceId && (
              <span style={{ color: colors.textDim, fontSize: 13 }}>
                workspace {connection.workspaceId}
              </span>
            )}
          </Inline>

          {connected ? (
            <Inline gap={2}>
              <Button variant="secondary" disabled={syncing} onClick={() => void syncNow()}>
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
              <Button variant="secondary" onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </Inline>
          ) : (
            <Stack gap={2}>
              <Field label="Ovation API URL" hint="The API host for your Ovation account.">
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  autoComplete="off"
                  style={inputStyle}
                />
              </Field>
              <Field
                label="Workspace ID"
                hint="Shown in Ovation under workspace settings → OverlaySys."
              >
                <input
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  autoComplete="off"
                  style={inputStyle}
                />
              </Field>
              <Field
                label="Operator key"
                hint="Issue one in Ovation under workspace settings → OverlaySys. It is shown there only once."
              >
                <input
                  type="password"
                  value={operatorKey}
                  onChange={(e) => setOperatorKey(e.target.value)}
                  autoComplete="off"
                  style={inputStyle}
                />
              </Field>
              <div>
                <Button
                  variant="primary"
                  disabled={
                    connecting || !baseUrl.trim() || !workspaceId.trim() || !operatorKey.trim()
                  }
                  onClick={() => void connect()}
                >
                  {connecting ? "Connecting…" : "Connect"}
                </Button>
              </div>
            </Stack>
          )}
        </Stack>
      </Panel>

      <Panel title="Sync">
        <Stack gap={2}>
          {sync?.lastError && (
            <div style={{ color: colors.danger, fontSize: 13 }}>{sync.lastError}</div>
          )}
          <div style={{ color: colors.textDim, fontSize: 13 }}>
            {sync?.lastRanAt
              ? `Last pass ${new Date(sync.lastRanAt).toLocaleString()}`
              : "No sync has run yet."}
          </div>
          {sync?.lastResult && (
            <div style={{ color: colors.textDim, fontSize: 13 }}>
              Pulled {sync.lastResult.pulled}, pushed {sync.lastResult.pushed}
              {sync.lastResult.errors.length > 0
                ? `, ${sync.lastResult.errors.length} record error(s)`
                : ""}
            </div>
          )}
          <p style={{ color: colors.textDim, fontSize: 12 }}>
            Shows sync automatically every five minutes. Pulled shows appear in the show
            picker — take them on air from the operator screen as usual.
          </p>
        </Stack>
        </Panel>
        </Stack>
      </PageBody>
    </>
  );
}
