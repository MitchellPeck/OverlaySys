"use client";

import { useEffect, type ReactNode } from "react";
import { useSetShellChrome } from "./ShellChromeContext";
import { composeDocTitle, DEFAULT_DOC_TITLE } from "./docTitle";

/**
 * Declared near the top of a page's body to feed the shell top bar. Renders
 * nothing. Clears the chrome on unmount so a page's title never lingers after
 * navigation.
 */
export function PageChrome({
  title,
  context,
  actions,
  docTitle,
}: {
  title?: ReactNode;
  context?: ReactNode;
  actions?: ReactNode;
  /** Browser tab title; defaults to a string `title`. */
  docTitle?: string;
}): null {
  const setChrome = useSetShellChrome();
  useEffect(() => {
    document.title = composeDocTitle(docTitle, title);
    return () => {
      document.title = DEFAULT_DOC_TITLE;
    };
  }, [docTitle, title]);
  useEffect(() => {
    setChrome({ title, context, actions });
    return () => setChrome({});
  }, [setChrome, title, context, actions]);
  return null;
}
