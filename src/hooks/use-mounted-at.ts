"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";

const subscribe = () => () => {};

// 只给不水合的一次性渲染（README 卡片）用：服务端首帧直接取出图时刻，配速、倒计时这类按时刻算的内容随图烧进去。
export const RenderClock = createContext(0);

// 「换成此刻」的二次渲染若在水合收尾一并发生，所有卡会挤进同一个大提交；每卡一个任务摊开放行。
// 放行前读数仍是服务端定格时刻，水合产物与 SSR 一致，不产生额外 diff。
export type ClockGate = { armed: boolean; listeners: Set<() => void> };

export const ClockGateContext = createContext<ClockGate | null>(null);

const armQueue: ClockGate[] = [];
let pumpQueued = false;

function pumpArmQueue() {
  pumpQueued = false;
  const gate = armQueue.shift();
  if (!gate) return;
  gate.armed = true;
  for (const listener of [...gate.listeners]) listener();
  if (armQueue.length) {
    pumpQueued = true;
    setTimeout(pumpArmQueue, 0);
  }
}

export function createClockGate(): ClockGate {
  return { armed: false, listeners: new Set() };
}

function subscribeClockGate(gate: ClockGate, listener: () => void): () => void {
  gate.listeners.add(listener);
  if (!gate.armed && !armQueue.includes(gate)) armQueue.push(gate);
  if (!pumpQueued) {
    pumpQueued = true;
    setTimeout(pumpArmQueue, 0);
  }
  return () => {
    gate.listeners.delete(listener);
  };
}

// getServerSnapshot 只在水合期被调用，用它标记「这是水合实例」：只有这类实例在未放行时读定格值，
// 水合后新挂载的组件没有服务端首帧要对齐，必须首帧就取此刻——按锚点画一帧再跳会破坏进度、歌词。
export function makeMountedAtSource(gate: ClockGate | null, renderClock: number) {
  let at = 0;
  let hydrating = false;
  const now = () => (at ||= Date.now());
  return {
    subscribe: gate ? (listener: () => void) => subscribeClockGate(gate, listener) : subscribe,
    getSnapshot: () => (hydrating && gate && !gate.armed ? renderClock : now()),
    getServerSnapshot: () => {
      if (at) return at;
      hydrating = true;
      return renderClock;
    },
  };
}

// SSR 与水合首帧不能各读本机时钟，否则时间派生内容不一致。
export function useMountedAt(): number {
  const renderClock = useContext(RenderClock);
  const gate = useContext(ClockGateContext);
  const src = useMemo(() => makeMountedAtSource(gate, renderClock), [gate, renderClock]);
  return useSyncExternalStore(src.subscribe, src.getSnapshot, src.getServerSnapshot);
}

// 只问「是否已在浏览器挂载」，不受 RenderClock 影响：出图那次仍按服务端首帧裁剪。
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
