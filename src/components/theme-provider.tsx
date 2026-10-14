"use client";

import { useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";

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
  // 水合那一轮拿到的是服务端快照（system、非深色），按它写会把已是深色的首屏刷成浅色一帧；只用作触发，值现读。
  useLayoutEffect(() => syncThemeToDocument(readThemeChoice(), readSystemDark()), [theme, systemDark]);
  return children;
}
