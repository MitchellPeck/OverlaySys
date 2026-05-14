"use client";

import { AppHeader } from "@/app/components/AppHeader";
import { PageShell, PageBody } from "@/app/components/PageShell";
import { ExportBundle } from "./ExportBundle";
import { ImportPreview } from "./ImportPreview";

export default function DataPage() {
  return (
    <PageShell>
      <AppHeader title="Data" />
      <PageBody maxWidth={1100}>
        <ExportBundle />
        <ImportPreview />
      </PageBody>
    </PageShell>
  );
}
