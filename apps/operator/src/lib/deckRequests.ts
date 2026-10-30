/** Deck ids whose get_deck is in flight or answered; cleared on reconnect and on not_found. */
export const requestedDecks = new Set<string>();

/** Live-folder ids whose list_live_folder was sent from Live; cleared on reconnect. */
export const requestedLiveFolders = new Set<string>();
