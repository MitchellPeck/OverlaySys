import type { ActiveGraphic, RundownRow } from "@overlaysys/core";
import {
  rowDisplayLabel,
  sectionDisplayLabel,
  songTitleForChannel,
} from "./labels";
import type { CompanionState } from "./types";

export const RUNDOWN_LIMIT = 40;

export interface VariableDefinition {
  variableId: string;
  name: string;
}

export function variableDefinitions(channels: string[]): VariableDefinition[] {
  const defs: VariableDefinition[] = [];

  for (const c of channels) {
    defs.push(
      { variableId: `${c}_template_id`, name: `${c} template id` },
      { variableId: `${c}_template_name`, name: `${c} template name` },
      { variableId: `${c}_is_live`, name: `${c} is live (yes/no)` },
      { variableId: `${c}_phase`, name: `${c} transition phase` },
      { variableId: `${c}_song_title`, name: `${c} song title` },
      { variableId: `${c}_song_section`, name: `${c} song section label` },
      { variableId: `${c}_song_slide_idx`, name: `${c} song slide index (1-based)` },
      { variableId: `${c}_song_slide_text`, name: `${c} song slide first line` },
      { variableId: `${c}_song_blanked`, name: `${c} song is blanked (yes/no)` },
      { variableId: `${c}_song_trust_mode`, name: `${c} song trust mode (yes/no)` },
    );
    for (let i = 1; i <= 10; i++) {
      defs.push({
        variableId: `${c}_data_${i}_key`,
        name: `${c} data slot ${i} key`,
      });
      defs.push({
        variableId: `${c}_data_${i}_value`,
        name: `${c} data slot ${i} value`,
      });
    }
  }

  defs.push(
    { variableId: "connection_state", name: "WebSocket connection state" },
    { variableId: "last_error", name: "Last server-reported error" },
    { variableId: "stt_running", name: "STT spawner running (yes/no)" },
    { variableId: "stt_listener_count", name: "Online STT listeners" },
    { variableId: "loaded_show_id", name: "Loaded show id" },
    { variableId: "loaded_show_name", name: "Loaded show name" },
    { variableId: "loaded_show_row_count", name: "Loaded show row count" },
    { variableId: "cursor_row_idx", name: "Cursor row index (1-based)" },
    { variableId: "cursor_row_name", name: "Cursor row display label" },
    { variableId: "cursor_row_kind", name: "Cursor row kind (song/graphic)" },
  );

  for (let n = 1; n <= RUNDOWN_LIMIT; n++) {
    defs.push(
      { variableId: `rundown_${n}_name`, name: `Rundown row ${n} display label` },
      { variableId: `rundown_${n}_kind`, name: `Rundown row ${n} kind` },
      { variableId: `rundown_${n}_is_active`, name: `Rundown row ${n} matches PGM` },
    );
  }

  return defs;
}

function rowMatchesPgm(
  active: ActiveGraphic | null | undefined,
  pgmSongId: string | undefined,
  row: RundownRow,
): boolean {
  if (row.kind === "song") {
    return Boolean(pgmSongId && pgmSongId === row.songId);
  }
  if (!active) return false;
  if (active.templateId !== row.templateId) return false;
  const a = active.data;
  const b = row.data;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export function projectVariables(
  state: CompanionState,
  channels: string[],
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const c of channels) {
    const ch = state.channelStates.get(c);
    const active = ch?.active ?? null;
    const tpl = active
      ? state.templates.find((t) => t.id === active.templateId)
      : undefined;
    out[`${c}_template_id`] = active?.templateId ?? "";
    out[`${c}_template_name`] = tpl?.name ?? "";
    out[`${c}_is_live`] = active ? "yes" : "no";
    out[`${c}_phase`] = active?.phase ?? "";

    const keys = active ? Object.keys(active.data).sort() : [];
    for (let i = 1; i <= 10; i++) {
      const k = keys[i - 1];
      out[`${c}_data_${i}_key`] = k ?? "";
      out[`${c}_data_${i}_value`] = k && active ? active.data[k] ?? "" : "";
    }

    const sess = ch?.songSession;
    out[`${c}_song_title`] = songTitleForChannel(state, c);
    if (sess) {
      const song = state.songCache.get(sess.songId);
      out[`${c}_song_section`] = song
        ? sectionDisplayLabel(song, sess.arrangement, sess.cursor.sectionIdx)
        : "";
      out[`${c}_song_slide_idx`] = String(sess.cursor.slideIdx + 1);
      const sectionId = sess.arrangement[sess.cursor.sectionIdx];
      const section = song?.sections.find((s) => s.id === sectionId);
      const slide = section?.slides[sess.cursor.slideIdx];
      out[`${c}_song_slide_text`] = slide?.text.split("\n")[0] ?? "";
      out[`${c}_song_blanked`] = sess.blanked ? "yes" : "no";
      out[`${c}_song_trust_mode`] = sess.trustMode ? "yes" : "no";
    } else {
      out[`${c}_song_section`] = "";
      out[`${c}_song_slide_idx`] = "";
      out[`${c}_song_slide_text`] = "";
      out[`${c}_song_blanked`] = "";
      out[`${c}_song_trust_mode`] = "";
    }
  }

  out.connection_state = state.connectionState;
  out.last_error = state.lastError ?? "";
  out.stt_running = state.sttSpawner?.state === "running" ? "yes" : "no";
  out.stt_listener_count = String(
    state.sttListeners.filter((l) => l.online).length,
  );

  const loadedShow = state.loadedShowId
    ? state.showCache.get(state.loadedShowId)
    : undefined;
  const loadedShowMeta = state.loadedShowId
    ? state.shows.find((s) => s.id === state.loadedShowId)
    : undefined;
  out.loaded_show_id = state.loadedShowId ?? "";
  out.loaded_show_name = loadedShowMeta?.name ?? loadedShow?.name ?? "";
  out.loaded_show_row_count = loadedShow ? String(loadedShow.rows.length) : "";

  const cursor = state.loadedShowRowCursor;
  const cursorRow =
    loadedShow && cursor != null ? loadedShow.rows[cursor] : undefined;
  out.cursor_row_idx = cursor != null ? String(cursor + 1) : "";
  out.cursor_row_name = cursorRow ? rowDisplayLabel(state, cursorRow) : "";
  out.cursor_row_kind = cursorRow?.kind ?? "";

  const pgmSongId = state.channelStates.get("program")?.songSession?.songId;
  const pgmActive = state.channelStates.get("program")?.active ?? null;
  for (let n = 1; n <= RUNDOWN_LIMIT; n++) {
    const row = loadedShow?.rows[n - 1];
    out[`rundown_${n}_name`] = row ? rowDisplayLabel(state, row) : "";
    out[`rundown_${n}_kind`] = row?.kind ?? "";
    out[`rundown_${n}_is_active`] =
      row && rowMatchesPgm(pgmActive, pgmSongId, row) ? "yes" : "no";
  }

  return out;
}
