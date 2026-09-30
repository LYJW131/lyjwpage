"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { StatusDot } from "@/components/ui/status-dot";

const DOCK_ID = "dev-toggles";

export const isDev = process.env.NODE_ENV === "development";

export function DevToggleDock() {
  if (!isDev) return null;
  return <div id={DOCK_ID} className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2" />;
}

const subscribeNoop = () => () => {};

export function DevToggleSlot({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  if (!isDev || !mounted) return null;
  const dock = document.getElementById(DOCK_ID);
  if (!dock) return null;
  return createPortal(children, dock);
}

export function DevToggle({
  label,
  on,
  onClick,
  states = ["Shown", "Hidden"],
  title,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  states?: [string, string];
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="paper-card flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
      title={title ?? `开发环境调试：切换${label}`}
    >
      <StatusDot tone={on ? "live" : "off"} />
      <span className="label-mono">
        {label}: {on ? states[0] : states[1]}
      </span>
    </button>
  );
}
