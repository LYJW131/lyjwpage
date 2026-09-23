"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { flushSync } from "react-dom";

const OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
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
      aria-label="Toggle theme (light / dark / system)"
      onClick={() => {
        const currentChoice = theme ?? "system";
        const index = OPTIONS.findIndex((option) => option.value === currentChoice);
        const next = OPTIONS[(index + 1) % OPTIONS.length].value;
        applyTheme(setTheme, next);
      }}
      className="paper-card relative flex size-8 items-center justify-center rounded-md border border-line-strong bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground after:absolute after:-inset-1"
    >
      <Sun className="theme-toggle-icon theme-toggle-icon-light size-4" />
      <Moon className="theme-toggle-icon theme-toggle-icon-dark size-4" />
      <Monitor className="theme-toggle-icon theme-toggle-icon-system size-4" />
    </button>
  );
}
