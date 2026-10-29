"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal, SegmentedControl, toast } from "@overlaysys/ui";
import { ackErrorText, sendAndAwaitAck } from "@/lib/awaitAck";
import { newLayoutFrom, STAGE_START_FROM, type StageStartFrom } from "@/lib/stageDesigner";
import { getClient } from "@/lib/useWs";
import { useConnection } from "@/lib/useConnection";
import { PageChrome } from "@/app/shell/PageChrome";

const START_LABELS: Record<StageStartFrom, string> = {
  blank: "Blank",
  speaker: "Speaker",
  lyrics: "Lyrics",
  scripture: "Scripture",
};

const START_HINTS: Record<StageStartFrom, string> = {
  blank: "An empty canvas.",
  speaker: "Row title, live and next slide, notes, timer, clock and cue.",
  lyrics: "A large live slide with next slide, timer and clock below.",
  scripture: "Reference and verse, next verse, timer, clock and notes.",
};

/** `/design/stage/edit?new=1`: pick a starting point and a name, then open the new layout. */
export function StageStartDialog() {
  const router = useRouter();
  const { connected } = useConnection();
  const [start, setStart] = useState<StageStartFrom>("speaker");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();

  function cancel() {
    router.push("/design?tab=stage");
  }

  async function create() {
    if (!trimmed || busy) return;
    if (!connected) {
      toast({ tone: "error", message: "Not connected to the server; the layout was not created." });
      return;
    }
    const layout = newLayoutFrom(start, trimmed);
    setBusy(true);
    try {
      await sendAndAwaitAck(getClient(), { type: "save_stage_layout", layout }, { op: "save_stage_layout", id: layout.id });
    } catch (e) {
      setBusy(false);
      toast({ tone: "error", message: `Not created: ${ackErrorText(e)}` });
      return;
    }
    router.replace(`/design/stage/edit?id=${encodeURIComponent(layout.id)}`);
  }

  return (
    <>
      <PageChrome title="New stage layout" />
      <Modal
        open
        title="New stage layout"
        onClose={cancel}
        onConfirm={() => void create()}
        footer={
          <>
            <Button variant="ghost" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void create()} disabled={!trimmed || busy || !connected}>
              Create
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Start from" hint={START_HINTS[start]}>
            <SegmentedControl<StageStartFrom>
              aria-label="Start from"
              value={start}
              onChange={setStart}
              options={STAGE_START_FROM.map((v) => ({ value: v, label: START_LABELS[v] }))}
            />
          </Field>
          <Field label="Name">
            <Input autoFocus required aria-label="Layout name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pastor monitor" />
          </Field>
        </div>
      </Modal>
    </>
  );
}
