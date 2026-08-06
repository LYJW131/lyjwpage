"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label="切换主题"
      // 在渲染期读 resolvedTheme 会和服务端对不上，放到事件里读就没这问题
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="flex size-8 items-center justify-center rounded-md border border-line text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
    >
      {/* 两个图标都渲染，由 CSS 决定显示哪个 —— 不需要 mounted 状态，也就没有 hydration 闪烁 */}
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </button>
  );
}
