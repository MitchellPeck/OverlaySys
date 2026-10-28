/** Deck ids whose get_deck is in flight or answered; cleared on reconnect and on not_found. */
export const requestedDecks = new Set<string>();
