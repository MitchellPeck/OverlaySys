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
 * How to navigate to a link target after the user chose to leave. Standing on
 * our sentinel entry, replace it so no extra editor entry is left behind
 * (history [P, E, S] -> [P, E, N]); otherwise a plain push.
 */
export function leaveMethod(onSentinel: boolean): "replace" | "push" {
  return onSentinel ? "replace" : "push";
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

/** What a page's guard decides when something other than a link click wants to leave. */
export type LeaveDecision = { navigate: boolean; method: "push" | "replace" };

type LeaveGuard = () => Promise<LeaveDecision>;

// One guard per mounted dirty editor; the latest registered is the one in front.
const leaveGuards: LeaveGuard[] = [];

/** Register a page's guard while it has unsaved changes; returns the unregister function. */
export function registerLeaveGuard(guard: LeaveGuard): () => void {
  leaveGuards.push(guard);
  return () => {
    const i = leaveGuards.indexOf(guard);
    if (i >= 0) leaveGuards.splice(i, 1);
  };
}

/**
 * Programmatic navigation (command palette, global shortcuts): asks the open
 * editor's guard first, exactly as a link click would, then pushes or
 * replaces as the guard says. With no dirty editor it is a plain push.
 */
export async function guardedNavigate(
  href: string,
  router: { push(href: string): void; replace(href: string): void },
): Promise<void> {
  const guard = leaveGuards[leaveGuards.length - 1];
  const decision: LeaveDecision = guard ? await guard() : { navigate: true, method: "push" };
  if (!decision.navigate) return;
  if (decision.method === "replace") router.replace(href);
  else router.push(href);
}
