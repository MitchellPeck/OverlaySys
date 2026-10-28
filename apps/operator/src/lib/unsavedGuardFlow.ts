import type { ButtonVariant } from "@overlaysys/ui";

export type GuardChoice = "stay" | "discard" | "save";
export type GuardOrigin = "link" | "pop";

/** Buttons of the unsaved-changes dialog; Save and leave only when the page can save. */
export function guardActions(canSave: boolean): { id: GuardChoice; label: string; variant: ButtonVariant }[] {
  const actions: { id: GuardChoice; label: string; variant: ButtonVariant }[] = [
    { id: "stay", label: "Stay", variant: "secondary" },
    { id: "discard", label: "Discard changes", variant: "danger" },
  ];
  if (canSave) actions.push({ id: "save", label: "Save and leave", variant: "primary" });
  return actions;
}

/**
 * What to do after the dialog. `saved` is the onSave result (null when not
 * attempted). A popped sentinel was re-pushed before asking, so leaving by
 * history means going back past both entries (-2); a link just pushes.
 */
export function afterChoice(
  choice: GuardChoice,
  saved: boolean | null,
  origin: GuardOrigin,
): { navigate: boolean; historySteps: number } {
  const leave = choice === "discard" || (choice === "save" && saved === true);
  if (!leave) return { navigate: false, historySteps: 0 };
  return { navigate: true, historySteps: origin === "pop" ? -2 : 0 };
}
