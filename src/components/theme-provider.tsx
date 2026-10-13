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
  // 根部重新生成会清掉 <html> 上 boot 脚本写的属性，layout effect 在同一次提交、绘制之前补回。
  // 水合那一遍 theme / systemDark 还是服务端快照，所以这里读实时值，只拿它们当触发依赖。
  useLayoutEffect(() => syncThemeToDocument(readThemeChoice(), readSystemDark()), [theme, systemDark]);
  return children;
}
