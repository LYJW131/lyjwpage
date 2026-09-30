"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

// React 19 会误报 next-themes 防闪烁脚本，过滤这一项开发告警。
type PatchedConsoleError = typeof console.error & { __themePatched?: true };

if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  const current = console.error as PatchedConsoleError;
  // HMR 重求值不能重复包裹 console.error。
  if (!current.__themePatched) {
    const originalError = console.error;
    const filtered: PatchedConsoleError = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].includes("Encountered a script tag")) {
        return;
      }
      originalError.apply(console, args);
    };
    filtered.__themePatched = true;
    console.error = filtered;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
