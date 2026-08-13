"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

const OPTIONS = [
  { value: "light", label: "明亮", Icon: Sun },
  { value: "dark", label: "深色", Icon: Moon },
  { value: "system", label: "自动", Icon: Monitor },
] as const;

function applyTheme(setTheme: (theme: string) => void, next: string) {
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
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const selected = OPTIONS.find((option) => option.value === theme) ?? OPTIONS[2];

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <button
      type="button"
      aria-label={`主题：${selected.label}，点击切换`}
      onClick={() => {
        const index = OPTIONS.findIndex((option) => option.value === selected.value);
        applyTheme(setTheme, OPTIONS[(index + 1) % OPTIONS.length].value);
      }}
      className="paper-card flex size-8 items-center justify-center rounded-md border border-line-strong bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground"
    >
      {mounted ? (
        <selected.Icon className="size-4" />
      ) : (
        <>
          {/* 首帧跟页面实际明暗走：亮出太阳、暗出月亮 */}
          <Sun className="size-4 dark:hidden" />
          <Moon className="hidden size-4 dark:block" />
        </>
      )}
    </button>
  );
}
