"use client";

import { AppHeader } from "@/app/components/AppHeader";
import { ExportBundle } from "./ExportBundle";

export default function DataPage() {
  return (
    <>
      <AppHeader context={<h1 style={{ margin: 0, fontSize: 16 }}>Data</h1>} />
      <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <ExportBundle />
      </div>
    </>
  );
}
