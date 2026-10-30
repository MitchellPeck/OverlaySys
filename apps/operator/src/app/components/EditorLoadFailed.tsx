"use client";

import { Button, colors } from "@overlaysys/ui";
import { PageChrome } from "@/app/shell/PageChrome";
import { PageBody } from "@/app/components/PageShell";

/** An editor whose item is missing or couldn't be loaded, with a way back to the list. */
export function EditorLoadFailed({
  message,
  backLabel,
  onBack,
}: {
  message: string;
  backLabel: string;
  onBack(): void;
}) {
  return (
    <>
      <PageChrome />
      <PageBody style={{ height: "100%" }}>
        <div role="alert" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
          <p style={{ margin: 0, color: colors.danger }}>{message}</p>
          <Button size="sm" onClick={onBack}>
            {backLabel}
          </Button>
        </div>
      </PageBody>
    </>
  );
}
