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
  confirm: { title: string; message: string; confirmLabel: string };
  messages(): ClientMessage[];
};

type LiveCommandState = {
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
 */
export function liveCommands(s: LiveCommandState): PaletteCommand[] {
  const { channelStates } = s;
  const cmds: PaletteCommand[] = [
    {
      id: "take-pvw",
      label: "Take preview to program",
      group: "On air",
      keywords: ["take", "pvw", "preview", "program", "go"],
      confirm: { title: "Take preview to program?", message: "What's on preview goes to program.", confirmLabel: "Take" },
      messages: () => pvwTakeMessages(channelStates.preview, s.show?.id ?? null),
    },
    {
      id: "clear-program",
      label: "Clear program",
      group: "On air",
      keywords: ["clear", "pgm", "program", "off air"],
      confirm: { title: "Clear program?", message: "Everything on program, including video, is cleared.", confirmLabel: "Clear program" },
      messages: () => clearChannelMessages(channelStates.program, "program"),
    },
    {
      id: "clear-preview",
      label: "Clear preview",
      group: "On air",
      keywords: ["clear", "pvw", "preview"],
      confirm: { title: "Clear preview?", message: "Everything on preview is cleared.", confirmLabel: "Clear preview" },
      messages: () => clearChannelMessages(channelStates.preview, "preview"),
    },
    {
      id: "clear-all",
      label: "Clear all outputs",
      group: "On air",
      keywords: ["clear", "all", "outputs", "panic"],
      confirm: { title: "Clear all outputs?", message: "Everything on every output is cleared.", confirmLabel: "Clear all" },
      messages: () =>
        Object.entries(channelStates)
          .filter(([, st]) => channelHasContent(st))
          .flatMap(([ch, st]) => clearChannelMessages(st, ch)),
    },
  ];
  for (const meta of s.hotcards) {
    if (meta.projectId !== s.currentProjectId) continue;
    const card = s.hotcardCache[meta.id];
    if (!card) continue;
    const keywords = ["hotcard", meta.name.toLowerCase(), ...(meta.hotkey ? [meta.hotkey.toLowerCase()] : [])];
    cmds.push(
      {
        id: `hotcard-cue:${meta.id}`,
        label: `Cue hotcard ${meta.name}`,
        group: "On air",
        keywords: ["cue", ...keywords],
        confirm: { title: `Cue ${meta.name}?`, message: `${meta.name} goes to preview.`, confirmLabel: "Cue" },
        messages: () => [hotcardFireMessage(card, "cue")],
      },
      {
        id: `hotcard-take:${meta.id}`,
        label: `Take hotcard ${meta.name}`,
        group: "On air",
        keywords: ["take", ...keywords],
        confirm: { title: `Take ${meta.name}?`, message: `${meta.name} goes on air.`, confirmLabel: "Take" },
        messages: () => [hotcardFireMessage(card, "take")],
      },
    );
  }
  return cmds;
}
