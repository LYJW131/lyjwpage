"use client";

import { useSyncExternalStore } from "react";

import { site } from "@/lib/site";

const formatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: site.timezone,
});

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 1000);
  return () => clearInterval(timer);
}

// 精确到秒，所以同一秒内多次调用返回的是同一个字符串，React 不会因此重渲染
function getSnapshot() {
  return formatter.format(new Date());
}

// 服务端渲染的时刻和客户端必然对不上，干脆渲染占位，挂载后再填
function getServerSnapshot() {
  return "--:--:--";
}

/** 我这边的当前时间 */
export function LocalTime() {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return <span className="font-mono tabular-nums">{now}</span>;
}
