"use client";

import { useEffect, useState } from "react";
import { Button, Panel, StatusDot, colors, fontFamily, fontSize } from "@overlaysys/ui";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { copyText } from "@/app/shell/clipboard";
import { getDesktopApi, type DesktopDiagnostics } from "@/lib/desktop";
import { httpBase } from "@/lib/pcoClient";
import { getClient } from "@/lib/useWs";
import { useStore } from "@/lib/store";

interface NetworkInfo {
  port: number;
  addresses: string[];
}

/**
 * Settings → Connection: where the server is listening and how other devices
 * (Companion / Stream Deck, stage displays, OBS on another PC) reach it.
 * Read-only for now — changing the port or bind address still means setting
 * PORT / HOST in the app's .env (see below); doing it here needs a server
 * setting the desktop reads before spawning the server.
 */
export default function ConnectionPage() {
  const conn = useStore((s) => s.conn);
  const [diag, setDiag] = useState<DesktopDiagnostics | null>(null);
  const [net, setNet] = useState<NetworkInfo | null>(null);
  const [wsUrl, setWsUrl] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setWsUrl(getClient().getUrl());
    let cancelled = false;
    void getDesktopApi()
      ?.getDiagnostics?.()
      .then((d) => !cancelled && setDiag(d))
      .catch(() => undefined);
    fetch(`${httpBase()}/api/network`)
      .then((r) => (r.ok ? (r.json() as Promise<NetworkInfo>) : null))
      .then((j) => !cancelled && setNet(j))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const api = diag ? getDesktopApi() : null;
  const port = net?.port ?? diag?.serverPort ?? null;
  const addresses = net?.addresses ?? diag?.lanAddresses ?? [];
  const bindHost = diag?.bindHost ?? null;
  const loopbackOnly = bindHost === "127.0.0.1" || bindHost === "localhost";

  return (
    <>
      <PageChrome title="Connection" />
      <PageBody maxWidth={720} style={{ height: "100%" }}>
        <Panel title="Server" padding="md" style={{ marginBottom: 16 }}>
          <Row label="Status">
            <StatusDot
              tone={conn === "open" ? "good" : conn === "closed" ? "bad" : "warn"}
              label={conn === "open" ? "Connected" : conn === "closed" ? "Disconnected" : "Connecting…"}
            />
          </Row>
          <Row label="This console">
            <Mono>{wsUrl || "—"}</Mono>
          </Row>
          <Row label="Port">{port !== null ? <Mono>{port}</Mono> : <Dim>unknown</Dim>}</Row>
          <Row label="Listening on">
            {bindHost ? (
              <>
                <Mono>{bindHost}</Mono>{" "}
                <Dim>{loopbackOnly ? "(this computer only)" : bindHost === "0.0.0.0" ? "(all network interfaces)" : ""}</Dim>
              </>
            ) : (
              <Dim>unknown (open the desktop app for details)</Dim>
            )}
          </Row>
        </Panel>

        <Panel title="Other devices on this network" padding="md" style={{ marginBottom: 16 }}>
          {loopbackOnly ? (
            <p style={{ color: colors.warn, fontSize: fontSize.sm, margin: 0 }}>
              The server only accepts connections from this computer (HOST={bindHost}).
            </p>
          ) : addresses.length > 0 && port !== null ? (
            <>
              <p style={{ color: colors.textDim, fontSize: fontSize.sm, margin: "0 0 8px" }}>
                Point Companion / Stream Deck at one of these, port {port}. Stage and output links per channel are in
                Settings → Channels.
              </p>
              {addresses.map((a) => (
                <Row key={a} label="Address">
                  <Mono>{a}:{port}</Mono>
                </Row>
              ))}
            </>
          ) : (
            <p style={{ color: colors.textDim, fontSize: fontSize.sm, margin: 0 }}>
              Couldn&apos;t detect this computer&apos;s network address. Use its IP with port {port ?? 4000}.
            </p>
          )}
        </Panel>

        <Panel title="Change port or address" padding="md" style={{ marginBottom: 16 }}>
          <p style={{ color: colors.textDim, fontSize: fontSize.sm, margin: 0 }}>
            Set <Mono>PORT</Mono> and <Mono>HOST</Mono> in the <Mono>.env</Mono> file in the OverlaySys app-data folder
            {diag ? (
              <>
                {" "}
                (next to <Mono>{diag.logPath}</Mono>)
              </>
            ) : null}
            , then restart OverlaySys. <Mono>HOST=127.0.0.1</Mono> keeps other devices out.
          </p>
        </Panel>

        {diag && (
          <Panel title="Diagnostics" padding="md">
            <Row label="Version">
              <Mono>
                OverlaySys {diag.appVersion}
                {diag.isDev ? " (dev)" : ""}
              </Mono>
            </Row>
            <Row label="Runtime">
              <Mono>
                Electron {diag.electron} · Node {diag.node}
              </Mono>
            </Row>
            <Row label="Displays">
              <span>
                {diag.displays.map((d) => (
                  <div key={d.id}>
                    {d.label || "Unlabeled"} — {d.bounds.width}×{d.bounds.height}
                    {d.primary ? <Dim> (primary)</Dim> : null}
                  </div>
                ))}
              </span>
            </Row>
            <Row label="Open outputs">{diag.openOutputs.length ? diag.openOutputs.join(", ") : <Dim>none</Dim>}</Row>
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
              {api?.copyDiagnostics && (
                <Button
                  size="sm"
                  onClick={() =>
                    void api.copyDiagnostics?.().then(
                      () => setNote("Diagnostics copied."),
                      () => setNote("Couldn't copy."),
                    )
                  }
                >
                  Copy diagnostics
                </Button>
              )}
              {!api?.copyDiagnostics && (
                <Button size="sm" onClick={() => void copyText(JSON.stringify(diag, null, 2)).then((ok) => setNote(ok ? "Copied." : "Couldn't copy."))}>
                  Copy diagnostics
                </Button>
              )}
              {api?.revealLogs && (
                <Button size="sm" variant="ghost" onClick={() => void api.revealLogs?.()}>
                  Reveal logs
                </Button>
              )}
              {note && <span style={{ color: colors.textDim, fontSize: fontSize.sm }}>{note}</span>}
            </div>
          </Panel>
        )}
      </PageBody>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "140px 1fr",
        gap: 12,
        alignItems: "baseline",
        marginBottom: 6,
        fontSize: fontSize.md,
      }}
    >
      <span style={{ color: colors.textDim, fontSize: fontSize.sm }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code style={{ fontFamily: fontFamily.mono, fontSize: fontSize.sm }}>{children}</code>;
}

function Dim({ children }: { children: React.ReactNode }) {
  return <span style={{ color: colors.textDim }}>{children}</span>;
}
