"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import {
  readSystemDark,
  readThemeChoice,
  setThemeChoice,
  subscribeSystemDark,
  subscribeThemeChoice,
  syncThemeToDocument,
  type ThemeChoice,
} from "@/lib/theme";

const serverChoice = (): ThemeChoice => "system";
const serverSystemDark = (): boolean => false;

export function useTheme(): { theme: ThemeChoice; setTheme: (next: ThemeChoice) => void } {
  const theme = useSyncExternalStore(subscribeThemeChoice, readThemeChoice, serverChoice);
  return { theme, setTheme: setThemeChoice };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const systemDark = useSyncExternalStore(subscribeSystemDark, readSystemDark, serverSystemDark);
  useEffect(() => syncThemeToDocument(theme, systemDark), [theme, systemDark]);
  return children;
}
