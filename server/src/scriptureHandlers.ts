import type { ScriptureRow } from "@overlaysys/core";
import { resolveScriptureIntro, introTemplateIdFor } from "@overlaysys/core";
import { BOOKS } from "@overlaysys/scripture";
import type { ClientMessage, ServerMessage } from "@overlaysys/ws-protocol";
import * as shows from "./shows";
import * as templates from "./templates";
import * as scriptureSession from "./scriptureSession";
import { loadScriptureSettings } from "./scriptureSettings";
import { getScriptureRegistry } from "./scripture";

export type ScriptureMessage = Extract<
  ClientMessage,
  { type: "scripture_take_intro" | "scripture_take_slide" | "scripture_advance" | "scripture_goto" | "scripture_end" }
>;

type Send = (m: ServerMessage) => void;

async function findRow(showId: string, rowId: string, send: Send): Promise<ScriptureRow | null> {
  const show = await shows.getShow(showId);
  if (!show) {
    send({ type: "error", code: "not_found", message: showId });
    return null;
  }
  const row = show.rows.find((r) => r.id === rowId);
  if (!row || row.kind !== "scripture") {
    send({ type: "error", code: "not_found", message: rowId });
    return null;
  }
  return row;
}

export async function handleScriptureMessage(msg: ScriptureMessage, send: Send): Promise<void> {
  switch (msg.type) {
    case "scripture_take_intro": {
      const row = await findRow(msg.showId, msg.rowId, send);
      if (!row) return;
      const settings = await loadScriptureSettings();
      const templateId = introTemplateIdFor(row, settings);
      if (!templateId) {
        send({ type: "error", code: "not_configured", message: "No intro configured for this scripture row" });
        return;
      }
      const tpl = await templates.getTemplate(templateId);
      if (!tpl) {
        send({ type: "error", code: "not_found", message: templateId });
        return;
      }
      const firstBook = row.slides[0]?.verses[0]?.book;
      const intro = resolveScriptureIntro(row, settings, [tpl], {
        bookName: BOOKS.find((b) => b.id === firstBook)?.name,
        translationName: getScriptureRegistry().listTranslations().find((t) => t.id === row.translation)?.name,
      });
      if (!intro) {
        send({ type: "error", code: "not_configured", message: "No intro configured for this scripture row" });
        return;
      }
      scriptureSession.takeIntro(msg.channel ?? row.channelHint ?? "program", msg.showId, row, intro);
      return;
    }
    case "scripture_take_slide": {
      const row = await findRow(msg.showId, msg.rowId, send);
      if (!row) return;
      const ok = scriptureSession.takeSlide(msg.channel ?? row.channelHint ?? "program", msg.showId, row, msg.slideIdx);
      if (!ok) send({ type: "error", code: "not_found", message: `slide ${msg.slideIdx + 1}` });
      return;
    }
    case "scripture_advance":
      scriptureSession.advance(msg.channel, msg.delta);
      return;
    case "scripture_goto":
      scriptureSession.goTo(msg.channel, msg.slideIdx);
      return;
    case "scripture_end":
      scriptureSession.end(msg.channel);
      return;
  }
}
