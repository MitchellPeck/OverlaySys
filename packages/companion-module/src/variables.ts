import type { ActiveGraphic, RundownRow } from "@overlaysys/core";
import {
  rowDisplayLabel,
  sectionDisplayLabel,
  songTitleForChannel,
} from "./labels";
import { ITEM_WARN_MS, type CompanionState } from "./types";
import { CURRENT_ITEM_TIMER_ID, formatSignedTime, formatTime, timerMs, timerPhase } from "@overlaysys/core";

export const RUNDOWN_LIMIT = 40;

export interface VariableDefinition {
  variableId: string;
  name: string;
}

function sanitizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export interface RundownFieldEntry {
  id: string;
  name: string;
  value: string;
}

/**
 * Per-row content-field variables for the loaded show: graphic rows expose each
 * `data[key]` as `rundown_<n>_field_<key>` (key sanitized) plus
 * `rundown_<n>_template_name`; scripture rows expose `rundown_<n>_field_reference`.
 * Definitions and values both derive from this list so they never drift.
 */
export function rundownFieldEntries(state: CompanionState): RundownFieldEntry[] {
  const entries: RundownFieldEntry[] = [];
  const show = state.loadedShowId
    ? state.showCache.get(state.loadedShowId)
    : undefined;
  if (!show) return entries;
  const count = Math.min(show.rows.length, RUNDOWN_LIMIT);
  for (let i = 0; i < count; i++) {
    const row = show.rows[i]!;
    const n = i + 1;
    if (row.kind === "graphic") {
      const tpl = state.templates.find((t) => t.id === row.templateId);
      entries.push({
        id: `rundown_${n}_template_name`,
        name: `Rundown row ${n} template name`,
        value: tpl?.name ?? row.templateId,
      });
      for (const [rawKey, value] of Object.entries(row.data)) {
        const key = sanitizeKey(rawKey);
        if (!key) continue;
        entries.push({
          id: `rundown_${n}_field_${key}`,
          name: `Rundown row ${n} field ${rawKey}`,
          value,
        });
      }
    } else if (row.kind === "scripture") {
      entries.push({
        id: `rundown_${n}_field_reference`,
        name: `Rundown row ${n} reference`,
        value: row.reference,
      });
    }
  }
  return entries;
}

export function variableDefinitions(
  channels: string[],
  state?: CompanionState,
): VariableDefinition[] {
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
      { variableId: `${c}_song_queued_title`, name: `${c} song queued by its intro (title)` },
      { variableId: `${c}_scripture_ref`, name: `${c} scripture slide reference` },
      { variableId: `${c}_scripture_slide`, name: `${c} scripture slide (n/total)` },
      { variableId: `${c}_scripture_text`, name: `${c} scripture slide text` },
      { variableId: `${c}_scripture_queued_ref`, name: `${c} scripture queued by its intro (reference)` },
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
    { variableId: "cursor_row_kind", name: "Cursor row kind (song/graphic/video/scripture)" },
    { variableId: "cursor_row_is_song", name: "Cursor row is a song (yes/no)" },
    { variableId: "notes_title", name: "Pastor notes title" },
    { variableId: "notes_point", name: "Pastor notes current point (1-based)" },
    { variableId: "notes_point_count", name: "Pastor notes point count" },
    { variableId: "notes_point_heading", name: "Pastor notes current point heading" },
    { variableId: "notes_next_heading", name: "Pastor notes next point heading" },
    { variableId: "stage_message", name: "Stage message currently showing" },
    { variableId: "item_timer", name: "Current item timer (M:SS, +M:SS in overtime)" },
    { variableId: "item_timer_label", name: "Current item timer label" },
    { variableId: "item_overtime", name: "Current item timer is in overtime (true/false)" },
  );

  for (let n = 1; n <= RUNDOWN_LIMIT; n++) {
    defs.push(
      { variableId: `rundown_${n}_name`, name: `Rundown row ${n} display label` },
      { variableId: `rundown_${n}_kind`, name: `Rundown row ${n} kind` },
      { variableId: `rundown_${n}_is_active`, name: `Rundown row ${n} matches PGM` },
    );
  }

  if (state) {
    for (const e of rundownFieldEntries(state)) {
      defs.push({ variableId: e.id, name: e.name });
    }
  }

  return defs;
}

function rowMatchesPgm(
  active: ActiveGraphic | null | undefined,
  pgmSongId: string | undefined,
  row: RundownRow,
  pgmScriptureRowId: string | undefined,
): boolean {
  if (row.kind === "song") {
    return Boolean(pgmSongId && pgmSongId === row.songId);
  }
  if (row.kind === "scripture") {
    return Boolean(pgmScriptureRowId === row.id || active?.scriptureContext?.rowId === row.id);
  }
  if (row.kind === "video") return false;
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
  now: number = Date.now(),
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
    out[`${c}_song_queued_title`] = ch?.queuedSong?.title ?? "";
    if (sess) {
      const song = state.songCache.get(sess.songId);
      out[`${c}_song_section`] = song
        ? sectionDisplayLabel(song, sess.arrangement, sess.cursor.sectionIdx)
        : "";
      out[`${c}_song_slide_idx`] = String(sess.cursor.slideIdx + 1);
      const sectionId = sess.arrangement[sess.cursor.sectionIdx];
      const section = song?.sections.find((s) => s.id === sectionId);
      const slide = section?.slides[sess.cursor.slideIdx];
      out[`${c}_song_slide_text`] = slide?.lines[0] ?? "";
      out[`${c}_song_blanked`] = sess.blanked ? "yes" : "no";
      out[`${c}_song_trust_mode`] = sess.trustMode ? "yes" : "no";
    } else {
      out[`${c}_song_section`] = "";
      out[`${c}_song_slide_idx`] = "";
      out[`${c}_song_slide_text`] = "";
      out[`${c}_song_blanked`] = "";
      out[`${c}_song_trust_mode`] = "";
    }

    const scr = ch?.scriptureSession;
    out[`${c}_scripture_ref`] = scr?.slideReference ?? "";
    out[`${c}_scripture_slide`] = scr ? `${scr.slideIdx + 1}/${scr.slideCount}` : "";
    out[`${c}_scripture_text`] = scr?.text ?? "";
    out[`${c}_scripture_queued_ref`] = ch?.queuedScripture?.reference ?? "";
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
  out.cursor_row_is_song = cursorRow ? (cursorRow.kind === "song" ? "yes" : "no") : "";

  const stage = state.stage;
  const hasNotes = !!stage && stage.pointCount > 0;
  out.notes_title = hasNotes ? stage.title ?? "" : "";
  out.notes_point = hasNotes ? String(stage.state.pointIdx + 1) : "";
  out.notes_point_count = stage ? String(stage.pointCount) : "0";
  out.notes_point_heading = hasNotes ? stage.pointHeading ?? "" : "";
  out.notes_next_heading = hasNotes ? stage.nextHeading ?? "" : "";
  out.stage_message = stage?.state.message?.text ?? "";

  const item = state.timers.find((t) => t.id === CURRENT_ITEM_TIMER_ID);
  if (item) {
    const ms = timerMs(item, now);
    out.item_timer =
      item.mode === "countdown" && item.overtime
        ? formatSignedTime(ms, "M:SS")
        : formatTime(ms, "M:SS");
    out.item_timer_label = item.label;
    out.item_overtime = String(timerPhase(item.mode, ms, item.overtime, ITEM_WARN_MS) === "over");
  } else {
    out.item_timer = "";
    out.item_timer_label = "";
    out.item_overtime = "false";
  }

  const pgmSongId = state.channelStates.get("program")?.songSession?.songId;
  const pgmScriptureRowId = state.channelStates.get("program")?.scriptureSession?.rowId;
  const pgmActive = state.channelStates.get("program")?.active ?? null;
  for (let n = 1; n <= RUNDOWN_LIMIT; n++) {
    const row = loadedShow?.rows[n - 1];
    out[`rundown_${n}_name`] = row ? rowDisplayLabel(state, row) : "";
    out[`rundown_${n}_kind`] = row?.kind ?? "";
    out[`rundown_${n}_is_active`] =
      row && rowMatchesPgm(pgmActive, pgmSongId, row, pgmScriptureRowId) ? "yes" : "no";
  }

  for (const e of rundownFieldEntries(state)) {
    out[e.id] = e.value;
  }

  return out;
}
