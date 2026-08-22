"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

// React 19 对客户端组件树中 next-themes 注入的防闪烁 script 标签抛出开发环境控制台告警。
// 过滤该项假阳性警告，避免开发环境错误弹窗阻断页面。
type PatchedConsoleError = typeof console.error & { __themePatched?: true };

if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  const current = console.error as PatchedConsoleError;
  // 打一次标记：HMR 每次重新求值本模块都会再包一层，上一次的包装被当成
  // originalError，几次热更新之后每条 console.error 要穿过一叠过滤器。
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
