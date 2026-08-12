"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { flushSync } from "react-dom";

function flipTheme(setTheme: (theme: string) => void, resolvedTheme: string | undefined) {
  const next = resolvedTheme === "dark" ? "light" : "dark";

  // View Transition：整页拍两张快照做交叉淡入，比给每个元素上 color transition 便宜得多
  if (
    typeof document !== "undefined" &&
    "startViewTransition" in document &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    document.startViewTransition(() => {
      flushSync(() => setTheme(next));
    });
    return;
  }

  setTheme(next);
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label="切换主题"
      // 在渲染期读 resolvedTheme 会和服务端对不上，放到事件里读就没这问题
      onClick={() => flipTheme(setTheme, resolvedTheme)}
      className="paper-card flex size-8 items-center justify-center rounded-md border border-line-strong bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground"
    >
      {/* 两个图标都渲染，由 CSS 决定显示哪个 —— 不需要 mounted 状态，也就没有 hydration 闪烁 */}
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </button>
  );
}
