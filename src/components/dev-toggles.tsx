"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { StatusDot } from "@/components/ui/status-dot";

/**
 * 开发环境右下角那排调试胶囊。
 *
 * 各处的开关（充电卡 / 充电宝可见性、假数据总开关）散在不同组件里，但要排成
 * 同一列：页面挂一个 Dock，各组件用 Slot 把自己的胶囊传送进去。生产构建
 * NODE_ENV 不是 development，Dock 和 Slot 都不渲染。
 */
const DOCK_ID = "dev-toggles";

export const isDev = process.env.NODE_ENV === "development";

export function DevToggleDock() {
  if (!isDev) return null;
  return <div id={DOCK_ID} className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2" />;
}

const subscribeNoop = () => () => {};

export function DevToggleSlot({ children }: { children: ReactNode }) {
  // 服务端和 hydrate 那一遍都当「还没挂载」，之后才去找 Dock：传送门没有服务端 HTML，
  // hydrate 时就渲染会对不上。useSyncExternalStore 的两份快照正是为这种「客户端才有」准备的。
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  if (!isDev || !mounted) return null;
  const dock = document.getElementById(DOCK_ID);
  if (!dock) return null;
  return createPortal(children, dock);
}

/** 一粒胶囊：一盏灯 + 「名字: 状态」 */
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
  /** 亮 / 灭时各写什么 */
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
