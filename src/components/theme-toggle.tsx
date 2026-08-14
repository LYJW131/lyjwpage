"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

const OPTIONS = [
  { value: "light", label: "明亮" },
  { value: "dark", label: "深色" },
  { value: "system", label: "自动" },
] as const;

function applyTheme(setTheme: (theme: string) => void, next: string) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.themeChoice = next;
  }

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

  return (
    <button
      type="button"
      aria-label="切换主题（明亮 / 深色 / 自动）"
      onClick={() => {
        const current = theme ?? "system";
        const index = OPTIONS.findIndex((option) => option.value === current);
        const next = OPTIONS[(index + 1) % OPTIONS.length].value;
        applyTheme(setTheme, next);
      }}
      className="paper-card flex size-8 items-center justify-center rounded-md border border-line-strong bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground"
    >
      <Sun className="hidden size-4 [html[data-theme-choice='light']_&]:block" />
      <Moon className="hidden size-4 [html[data-theme-choice='dark']_&]:block" />
      <Monitor className="hidden size-4 [html:not([data-theme-choice])_&]:block [html[data-theme-choice='system']_&]:block" />
    </button>
  );
}
