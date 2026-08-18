"use client";

import { useSyncExternalStore } from "react";

import { LATEST_VERSION, unreadCount } from "@/lib/changelog";

/**
 * 「这台浏览器看到第几条了」和「面板开着没有」。
 *
 * 两样都是模块级单例，和 use-live-events / use-online-count 那两条长连接同一个
 * 路子 —— 页脚有两个入口（有未读时的那条窄条、和常驻的那个「更新日志」），
 * 它们不是父子关系，得共用同一份状态才能互相开关。
 *
 * 走 useSyncExternalStore 而不是 useState + useEffect：localStorage 本来就是外部
 * 数据源，`getServerSnapshot` 正好表达「服务端那一遍当作没有未读」；而在 effect
 * 里同步 setState 会多一轮渲染，`react-hooks/set-state-in-effect` 也不许那么写
 * （和 hooks/use-mounted-at 是同一个理由）。
 */

/** 存的是「看到第几条」这一个数字，别存 JSON —— 一个数不值得一层解析和一次容错 */
const SEEN_KEY = "changelog-seen";

export type ChangelogState = {
  /** localStorage 里那个数；null = 这台浏览器没有记录（第一次来） */
  seen: number | null;
  /**
   * 打开面板那一刻的 seen，冻住的。
   *
   * 打开的同时就把进度记成最新（不然「关掉窗口就当没看过」会让同一条反复弹），
   * 于是列表里那条「以下是你看过的」失去依据 —— 所以另存一份打开前的值，
   * 只服务这条线；页面一刷新就没了，本来也只是这一次的上下文。
   */
  readUpTo: number | null;
  open: boolean;
};

/**
 * 服务端预渲染和 hydrate 那一遍用的快照：当作「都看过」。
 *
 * 首屏静态壳里没有 localStorage 可读，画不出真实状态。画成「有未读」再改回去
 * 是一次可见的闪烁，还必然水合不一致；画成「都看过」的代价只是窄条晚一帧出现，
 * 而它在页脚上方，那个位置多数时候在首屏之外。
 *
 * 必须是模块级常量：useSyncExternalStore 要求快照引用稳定，每次现造一个对象
 * 会被判成「变了」，然后无限重渲染。
 */
const SERVER_STATE: ChangelogState = { seen: LATEST_VERSION, readUpTo: null, open: false };

let state: ChangelogState = { seen: null, readUpTo: null, open: false };
/** localStorage 只在第一次取快照时读一遍，之后由下面几处主动改缓存 */
let loaded = false;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function readSeen(): number | null {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (raw == null) return null;
    const parsed = Number(raw);
    // 存坏了（手改过、别的东西占了这个键）当作没有记录，别把 NaN 一路带进比较
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    // 无痕模式 / 禁用存储：读不到就一直读不到，当作「都看过」比每次进来都弹一条强
    return null;
  }
}

function writeSeen(version: number): void {
  try {
    window.localStorage.setItem(SEEN_KEY, String(version));
  } catch {
    // 写不进去只是下次还会再提示一遍，不值得为它多一条错误路径
  }
}

function getSnapshot(): ChangelogState {
  if (!loaded) {
    loaded = true;
    state = { ...state, seen: readSeen() };
  }
  return state;
}

function getServerSnapshot(): ChangelogState {
  return SERVER_STATE;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // 另一个标签页看过了，这一页的窄条也该跟着消失
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SEEN_KEY) return;
    loaded = false;
    emit();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * 第一次来的人：把当前进度悄悄记下，不提示。
 *
 * 不记的话「没有记录」会一直成立，于是他**永远**收不到提示 —— 每次来都是
 * 「没有记录 → 当作都看过」。
 *
 * 记完不通知：算出来的未读数前后都是 0，界面上一个像素都不会变，
 * 广播一次只是白白让每个订阅者重渲染。
 */
export function seedSeen(): void {
  if (getSnapshot().seen != null) return;
  writeSeen(LATEST_VERSION);
  state = { ...state, seen: LATEST_VERSION };
}

/** 窄条上那个叉：记成看过，但不打开面板 */
export function dismissChangelog(): void {
  if (getSnapshot().seen === LATEST_VERSION) return;
  writeSeen(LATEST_VERSION);
  state = { ...state, seen: LATEST_VERSION };
  emit();
}

export function openChangelog(): void {
  const { seen, open } = getSnapshot();
  // 已经开着就别再走一遍：那会把 readUpTo 重置成「刚记下的最新」，
  // 「以下是你看过的」那条线当场消失
  if (open) return;
  state = { seen: LATEST_VERSION, readUpTo: seen, open: true };
  writeSeen(LATEST_VERSION);
  emit();
}

export function closeChangelog(): void {
  if (!getSnapshot().open) return;
  // readUpTo 留着：这一次会话里再打开，那条「以下是你看过的」还在原处
  state = { ...state, open: false };
  emit();
}

export function useChangelog(): ChangelogState & { unread: number } {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ...snapshot, unread: unreadCount(snapshot.seen) };
}
