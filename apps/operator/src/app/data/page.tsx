"use client";

import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { ExportBundle } from "./ExportBundle";
import { ImportPreview } from "./ImportPreview";

export default function DataPage() {
  return (
    <>
      <PageChrome title="Data" />
      <PageBody maxWidth={1100} style={{ height: "100%" }}>
        <ExportBundle />
        <ImportPreview />
      </PageBody>
    </>
  );
}
