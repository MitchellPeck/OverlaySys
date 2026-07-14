"use client";

import { useEffect, type ReactNode } from "react";
import { useSetShellChrome } from "./ShellChromeContext";

/**
 * Declared near the top of a page's body to feed the shell top bar. Renders
 * nothing. Clears the chrome on unmount so a page's title never lingers after
 * navigation.
 */
export function PageChrome({
  title,
  context,
  actions,
}: {
  title?: ReactNode;
  context?: ReactNode;
  actions?: ReactNode;
}): null {
  const setChrome = useSetShellChrome();
  useEffect(() => {
    setChrome({ title, context, actions });
    return () => setChrome({});
  }, [setChrome, title, context, actions]);
  return null;
}
