"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "亮", Icon: Sun },
  { value: "dark", label: "暗", Icon: Moon },
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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selected = theme ?? "system";

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="选择主题"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="paper-card flex size-8 items-center justify-center rounded-md border border-line-strong bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground"
      >
        {/* 两个图标都渲染，由 CSS 决定显示哪个 —— 不需要 mounted 状态，也就没有 hydration 闪烁 */}
        <Sun className="hidden size-4 dark:block" />
        <Moon className="size-4 dark:hidden" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="主题"
          className="paper-card absolute right-0 top-[calc(100%+0.35rem)] z-50 min-w-24 border border-line-strong bg-surface p-1"
        >
          {OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={selected === value}
              onClick={() => {
                applyTheme(setTheme, value);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs",
                selected === value
                  ? "bg-surface-hover text-foreground"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
