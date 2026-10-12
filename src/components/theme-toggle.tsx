"use client";

import { Monitor, Moon, Sun } from "lucide-react";

import { useTheme } from "@/components/theme-provider";
import { THEME_CHOICES, type ThemeChoice } from "@/lib/theme";

function applyTheme(setTheme: (theme: ThemeChoice) => void, next: ThemeChoice) {
  if (
    "startViewTransition" in document &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    document.startViewTransition(() => setTheme(next));
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
        const next = THEME_CHOICES[(THEME_CHOICES.indexOf(theme) + 1) % THEME_CHOICES.length];
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
