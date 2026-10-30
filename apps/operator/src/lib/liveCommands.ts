import type { ChannelState, Hotcard, HotcardMeta, Show } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { channelHasContent, clearChannelMessages, pvwTakeMessages } from "./onAir";
import { hotcardFireMessage } from "./shortcutGuards";

/**
 * A Live on-air verb for the command palette (contracts §10). Every one has a
 * `confirm` (D17c: the palette never takes silently); the palette runs it
 * before sending `messages()`.
 */
export type PaletteCommand = {
  id: string;
  label: string;
  group: "On air";
  keywords: string[];
  /** danger: the confirm changes program (or another output), not just preview. */
  confirm: { title: string; message: string; confirmLabel: string; danger?: boolean };
  /** Built from the state read when called (after the confirm), never from the listing snapshot. */
  messages(): ClientMessage[];
};

/** The one Clear all copy: the Live header button and the palette both ask this. */
export const CLEAR_ALL_CONFIRM = {
  title: "Clear all outputs?",
  message: "Everything on every output is cleared.",
  confirmLabel: "Clear all",
  danger: true,
  enterConfirms: true,
} as const;

export type LiveCommandState = {
  channelStates: Record<string, ChannelState>;
  hotcards: HotcardMeta[];
  hotcardCache: Record<string, Hotcard>;
  currentProjectId: string;
  show: Show | null;
};

/**
 * The palette's On air commands: Take PVW, the three clears, and Cue / Take
 * for each hotcard of the current project. A hotcard whose body isn't loaded
 * yet is left out: it has no data to send.
 *
 * Pass a getter (e.g. `useStore.getState`): the list comes from one read, but
 * each `messages()` reads the state again, so a command confirmed seconds
 * later sends what is on the outputs then (another console may have changed
 * preview, started a video, or edited the hotcard meanwhile). A plain object
 * is accepted for tests and is read as-is.
 */
export function liveCommands(source: LiveCommandState | (() => LiveCommandState)): PaletteCommand[] {
  const get = typeof source === "function" ? source : () => source;
  const s = get();
  const cmds: PaletteCommand[] = [
    {
      id: "take-pvw",
      label: "Take preview to program",
      group: "On air",
      keywords: ["take", "pvw", "preview", "program", "go"],
      confirm: { title: "Take preview to program?", message: "What's on preview goes to program.", confirmLabel: "Take", danger: true },
      messages: () => {
        const now = get();
        return pvwTakeMessages(now.channelStates.preview, now.show?.id ?? null);
      },
    },
    {
      id: "clear-program",
      label: "Clear program",
      group: "On air",
      keywords: ["clear", "pgm", "program", "off air"],
      confirm: { title: "Clear program?", message: "Everything on program, including video, is cleared.", confirmLabel: "Clear program", danger: true },
      messages: () => clearChannelMessages(get().channelStates.program, "program"),
    },
    {
      id: "clear-preview",
      label: "Clear preview",
      group: "On air",
      keywords: ["clear", "pvw", "preview"],
      confirm: { title: "Clear preview?", message: "Everything on preview is cleared.", confirmLabel: "Clear preview" },
      messages: () => clearChannelMessages(get().channelStates.preview, "preview"),
    },
    {
      id: "clear-all",
      label: "Clear all outputs",
      group: "On air",
      keywords: ["clear", "all", "outputs", "panic"],
      confirm: { ...CLEAR_ALL_CONFIRM },
      messages: () =>
        Object.entries(get().channelStates)
          .filter(([, st]) => channelHasContent(st))
          .flatMap(([ch, st]) => clearChannelMessages(st, ch)),
    },
  ];
  /** The card's current body, if it is still a card of the current project. */
  const freshCard = (id: string): Hotcard | null => {
    const now = get();
    const card = now.hotcardCache[id];
    return card && card.projectId === now.currentProjectId ? card : null;
  };
  for (const meta of s.hotcards) {
    if (meta.projectId !== s.currentProjectId) continue;
    if (!s.hotcardCache[meta.id]) continue;
    const keywords = ["hotcard", meta.name.toLowerCase(), ...(meta.hotkey ? [meta.hotkey.toLowerCase()] : [])];
    cmds.push(
      {
        id: `hotcard-cue:${meta.id}`,
        label: `Cue hotcard ${meta.name}`,
        group: "On air",
        keywords: ["cue", ...keywords],
        confirm: { title: `Cue ${meta.name}?`, message: `${meta.name} goes to preview.`, confirmLabel: "Cue" },
        messages: () => {
          const card = freshCard(meta.id);
          return card ? [hotcardFireMessage(card, "cue")] : [];
        },
      },
      {
        id: `hotcard-take:${meta.id}`,
        label: `Take hotcard ${meta.name}`,
        group: "On air",
        keywords: ["take", ...keywords],
        confirm: { title: `Take ${meta.name}?`, message: `${meta.name} goes on air.`, confirmLabel: "Take", danger: true },
        messages: () => {
          const card = freshCard(meta.id);
          return card ? [hotcardFireMessage(card, "take")] : [];
        },
      },
    );
  }
  return cmds;
}
