import { hotcardRoute } from "@overlaysys/core";

/**
 * Which channel a rundown Cue or Take goes to. Cue always goes to preview;
 * Take goes to the hint unless it is missing, "preview" or "program", then
 * "program". One rule, shared with hotcards.
 */
export const cueTakeRoute: (hint: string | undefined, action: "cue" | "take") => string = hotcardRoute;
