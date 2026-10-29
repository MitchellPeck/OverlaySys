"use client";

import { useRouter } from "next/navigation";
import { Button, colors, fontSize, fontWeight } from "@overlaysys/ui";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { isCloudMode } from "@/lib/mode";

export default function NotFound() {
  const router = useRouter();
  const cloud = isCloudMode();
  return (
    <PageBody variant="form">
      <PageChrome title="Not found" />
      <h1 style={{ margin: 0, fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text }}>
        That page doesn&apos;t exist
      </h1>
      <p style={{ margin: 0, color: colors.textDim, fontSize: fontSize.md }}>
        Check the address, or go back to where you were.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        {!cloud && (
          <Button variant="primary" onClick={() => router.push("/")}>
            Go to Live
          </Button>
        )}
        <Button onClick={() => router.push("/shows")}>Library</Button>
      </div>
    </PageBody>
  );
}
