// Press-twice confirmation for buttons that change what's on air (Clear all):
// the first press arms the button ("Sure?"), a second press inside the window
// goes through. No dialog, so the operator's hand never leaves the button.

/** How long an armed button waits for the second press. */
export const ARM_CONFIRM_MS = 3000;

/** A press on a press-twice button: fire, or (re)arm until `armedUntil`. */
export function armConfirmPress(
  armedUntil: number | null,
  now: number,
): { fire: boolean; armedUntil: number | null } {
  if (armedUntil !== null && now <= armedUntil) return { fire: true, armedUntil: null };
  return { fire: false, armedUntil: now + ARM_CONFIRM_MS };
}
