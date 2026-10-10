"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useLayoutEffect, type ReactNode } from "react";

import { THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "@/lib/theme-chrome";

function ThemeChrome() {
  const { resolvedTheme } = useTheme();
  useLayoutEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    const color = resolvedTheme === "dark" ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
    document.querySelectorAll('meta[name="theme-color"]').forEach((node) => {
      node.setAttribute("content", color);
    });
  }, [resolvedTheme]);
  return null;
}

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
      enableColorScheme
      disableTransitionOnChange
    >
      <ThemeChrome />
      {children}
    </NextThemesProvider>
  );
}
