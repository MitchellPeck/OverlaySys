"use client";

import { Button, Field, Input, colors } from "@overlaysys/ui";

const step = { color: colors.text, fontSize: 13, fontWeight: 600, margin: "0 0 6px" } as const;
const note = { color: colors.textDim, fontSize: 12, margin: "0 0 8px" } as const;

/**
 * Connect with a Planning Center personal access token. A real <form> so
 * Enter submits. The secret is a password field and is never echoed back.
 */
export function PcoConnectForm({
  appId,
  secret,
  connecting,
  error,
  showOAuth,
  onAppId,
  onSecret,
  onSubmit,
  onOAuth,
}: {
  appId: string;
  secret: string;
  connecting: boolean;
  error: string | null;
  /** Hidden in cloud mode (OAuth needs the desktop app). */
  showOAuth: boolean;
  onAppId: (v: string) => void;
  onSecret: (v: string) => void;
  onSubmit: () => void;
  onOAuth: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!connecting) onSubmit();
      }}
      style={{ maxWidth: 420, display: "flex", flexDirection: "column", gap: 16 }}
    >
      <div>
        <h2 style={{ margin: "0 0 4px", fontSize: 15, color: colors.text }}>
          Connect to Planning Center
        </h2>
        <p style={{ ...note, margin: 0 }}>Import service plans into OverlaySys.</p>
      </div>

      <div>
        <p style={step}>1. Create a personal access token</p>
        <p style={note}>
          Open{" "}
          <a
            href="https://api.planningcenteronline.com/oauth/applications"
            target="_blank"
            rel="noreferrer"
            style={{ color: colors.brandText }}
          >
            api.planningcenteronline.com
          </a>{" "}
          and create a token under Personal Access Tokens.
        </p>
      </div>

      <div>
        <p style={step}>2. Paste the Application ID and Secret</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Field label="Application ID" hint="PCO may label this “Client ID”.">
            <Input
              value={appId}
              onChange={(e) => onAppId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Secret">
            <Input
              type="password"
              value={secret}
              onChange={(e) => onSecret(e.target.value)}
              autoComplete="off"
            />
          </Field>
        </div>
      </div>

      {error && (
        <p role="alert" style={{ margin: 0, color: colors.errorText, fontSize: 13 }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Button type="submit" variant="primary" disabled={connecting}>
          {connecting ? "Connecting…" : "Connect"}
        </Button>
        {showOAuth && (
          <Button onClick={onOAuth}>Sign in with Planning Center</Button>
        )}
      </div>
    </form>
  );
}
