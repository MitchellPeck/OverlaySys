"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export type ShellChrome = {
  title?: ReactNode;
  context?: ReactNode;
  actions?: ReactNode;
};

const ChromeValue = createContext<ShellChrome>({});
const ChromeSetter = createContext<(c: ShellChrome) => void>(() => {});

export function ShellChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<ShellChrome>({});
  return (
    <ChromeSetter.Provider value={setChrome}>
      <ChromeValue.Provider value={chrome}>{children}</ChromeValue.Provider>
    </ChromeSetter.Provider>
  );
}

export function useShellChrome(): ShellChrome {
  return useContext(ChromeValue);
}

export function useSetShellChrome(): (c: ShellChrome) => void {
  return useContext(ChromeSetter);
}
