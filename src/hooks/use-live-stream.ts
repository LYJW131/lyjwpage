"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useSWRConfig } from "swr";
import type { ScopedMutator } from "swr";

import { mergeChargerHistory } from "@/lib/charger-history";
import type { NowWatchingPayload } from "@/lib/emby";
import type { ChargerPayload, DesktopPayload, MusicPayload, StatusResponse } from "@/lib/types";

const STREAM_PATH = "/api/status/stream";
/**
 * SWR 的缓存键就是请求路径，推送写进来的必须和轮询用的是同一个。
 *
 * 前台应用和播放各自携带最新数据；Emby watching 事件只让对应接口失效重取。
 */
export const DESKTOP_PATH = "/api/status/desktop";
export const MUSIC_PATH = "/api/status/music";
export const WATCHING_PATH = "/api/status/watching";
/** 正在播放和列表分开：前者 webhook 驱动，后者后端定时轮询 Emby */
export const NOW_WATCHING_PATH = "/api/status/watching/now";
export const CHARGER_PATH = "/api/status/charger";

/**
 * 整页共用一条 SSE 连接。
 *
 * 现在有多个组件要读活动状态（Live Desk 的前台应用、Recently Played 的本机
 * 播放），如果每个都自己 new 一个 EventSource，一个页面就会占掉好几条长连接。
 * 所以连接做成模块级单例，按订阅者数量开关。
 */
let source: EventSource | null = null;
let refCount = 0;
let connected = false;
const listeners = new Set<() => void>();

function setConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  for (const listener of listeners) listener();
}

function subscribeConnected(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function open(mutate: ScopedMutator) {
  if (source) return;
  const next = new EventSource(STREAM_PATH);
  source = next;

  // EventSource 自带指数退避重连，这里只需要如实反映当前状态
  next.onopen = () => setConnected(true);
  next.onerror = () => setConnected(false);

  // revalidate: false —— 推来的就是最新的，没必要再回源确认一次
  const forward = (path: string) => (event: MessageEvent<string>) => {
    const envelope: StatusResponse<DesktopPayload | MusicPayload> = {
      ok: true,
      data: JSON.parse(event.data) as DesktopPayload | MusicPayload,
      fetchedAt: new Date().toISOString(),
    };
    void mutate(path, envelope, { revalidate: false });
  };
  next.addEventListener("desktop", forward(DESKTOP_PATH));
  next.addEventListener("music", forward(MUSIC_PATH));
  /**
   * Emby 正在播放。直接写缓存，不再触发重取 —— 这条是 webhook 驱动的，
   * 服务端推来的就是最新的。列表不动：它由后端轮询 Emby，节奏慢得多，
   * 而且真要变也得等服务端那层缓存过期，让它跟着走没有意义。
   */
  next.addEventListener("watching", (event: MessageEvent<string>) => {
    void mutate(
      NOW_WATCHING_PATH,
      { ok: true, data: JSON.parse(event.data) as NowWatchingPayload, fetchedAt: new Date().toISOString() },
      { revalidate: false },
    );
  });
  /**
   * 充电头只在插拔、换设备时来事件，直接把状态写进缓存，不再触发一次重取。
   *
   * 曲线的合并走和轮询同一个累加器（lib/charger-history）。推来的那份不带
   * 历史点（空增量），所以合并只是把已有曲线原样接上 —— 游标不会被扰动，
   * 下一轮轮询照常从正确的位置继续拉。
   */
  next.addEventListener("charger", (event: MessageEvent<string>) => {
    const payload = mergeChargerHistory(JSON.parse(event.data) as ChargerPayload);
    void mutate(
      CHARGER_PATH,
      { ok: true, data: payload, fetchedAt: new Date().toISOString() },
      { revalidate: false },
    );
  });
  /**
   * 上报器上下线：让所有展示实时状态的接口重取一次，四张卡同时翻。
   *
   * vibe coding 不在其中 —— token 用量是累计的历史事实，Mac 掉线它不会变得
   * 不可信，只是不再增长，没有理由跟着变灰。
   */
  next.addEventListener("presence", () => {
    for (const path of [DESKTOP_PATH, MUSIC_PATH, CHARGER_PATH, NOW_WATCHING_PATH]) {
      void mutate(path);
    }
  });
}

function close() {
  source?.close();
  source = null;
  setConnected(false);
}

/**
 * 订阅服务端推送。
 *
 * 推来的活动状态直接写进 SWR 缓存，所以组件那边照旧用 useStatus 读，
 * 不用管数据是推来的还是轮询来的。轮询作为兜底保留 —— 长连接被中间代理
 * 掐断是迟早的事，`connected` 就是给调用方用来在断开时把轮询调快的。
 *
 * 不随页面可见性断开：连接闲置时只有 15 秒一次的心跳，成本远低于反复重连。
 */
export function useLiveStream() {
  const { mutate } = useSWRConfig();
  // 连接状态是个外部 store，交给 useSyncExternalStore 订阅比自己 setState 干净，
  // 服务端快照恒为 false（那边根本没有 EventSource）
  const isConnected = useSyncExternalStore(
    subscribeConnected,
    () => connected,
    () => false,
  );

  useEffect(() => {
    refCount += 1;
    open(mutate);
    return () => {
      refCount -= 1;
      if (refCount <= 0) {
        refCount = 0;
        close();
      }
    };
  }, [mutate]);

  return { connected: isConnected };
}
