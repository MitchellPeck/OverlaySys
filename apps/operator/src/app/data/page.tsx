"use client";

import { AppHeader } from "@/app/components/AppHeader";
import { ExportBundle } from "./ExportBundle";
import { ImportPreview } from "./ImportPreview";

export default function DataPage() {
  return (
    <>
      <AppHeader title="Data" />
      <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <ExportBundle />
        <ImportPreview />
      </div>
    </>
  );
}
