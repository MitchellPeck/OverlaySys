"use client";

import { useState } from "react";
import { Button, Field, Input, Modal, colors } from "@overlaysys/ui";
import { fetchCcliReport } from "./libraryClient";

function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Default range: the last full CCLI reporting period is usually ~6 months; start with 6. */
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 6);
  return { from: isoDay(from), to: isoDay(to) };
}

function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Download a CSV of songs taken to air in a date range (title, CCLI #,
 * author, copyright, times used) for CCLI copy reporting.
 */
export function CcliReportModal({ onClose }: { onClose: () => void }) {
  const [{ from, to }, setRange] = useState(defaultRange);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<number | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const csv = await fetchCcliReport(from, to);
      const count = Math.max(0, csv.trim().split(/\r?\n/).length - 1);
      setRows(count);
      if (count > 0) downloadText(`ccli-report-${from}-to-${to}.csv`, csv, "text/csv");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      onCancel={onClose}
      size="sm"
      title="CCLI usage report"
      footer={
        <>
          <Button onClick={onClose} variant="ghost" size="sm">Close</Button>
          <Button onClick={download} variant="primary" size="sm" disabled={busy || !from || !to || from > to}>
            {busy ? "Preparing…" : "Download CSV"}
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 12, color: colors.textDim, marginTop: 0 }}>
        Songs taken to program in this range, with CCLI numbers and how often each was used.
        Re-takes of a song within a few hours count once.
      </p>
      <Field label="From" layout="inline">
        <Input type="date" value={from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
      </Field>
      <Field label="To" layout="inline">
        <Input type="date" value={to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
      </Field>
      {rows === 0 && (
        <p style={{ fontSize: 12, color: colors.textDim }}>No song uses were logged in this range.</p>
      )}
      {rows !== null && rows > 0 && (
        <p style={{ fontSize: 12, color: colors.textDim }}>Downloaded {rows} song{rows === 1 ? "" : "s"}.</p>
      )}
      {error && <p style={{ fontSize: 12, color: colors.errorText }}>{error}</p>}
    </Modal>
  );
}
