"use client";

import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { ExportBundle } from "./ExportBundle";
import { ImportPreview } from "./ImportPreview";
import { CsvRundownImport } from "./CsvRundownImport";

export default function DataPage() {
  return (
    <>
      <PageChrome title="Data" />
      <PageBody variant="wide">
        <ExportBundle />
        <ImportPreview />
        <CsvRundownImport />
      </PageBody>
    </>
  );
}
