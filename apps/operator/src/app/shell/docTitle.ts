const APP_NAME = "OverlaySys";

/** Browser tab title: explicit docTitle, else a string page title, else the app name. */
export function composeDocTitle(docTitle?: string, title?: unknown): string {
  const part = docTitle?.trim() || (typeof title === "string" ? title.trim() : "");
  return part ? `${part} · ${APP_NAME}` : APP_NAME;
}

export const DEFAULT_DOC_TITLE = APP_NAME;
