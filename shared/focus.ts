import { mirrorKey } from "@shared/storage";

export type FocusMode = "mindfulness" | "sleep";

// 快捷指令只在模式开关时上报、没有心跳；关闭那一封丢了也要让卡片自己收起。
export const FOCUS_MAX_MS = 16 * 60 * 60_000;

// mode 为 null 表示 lyjw 不在这两种专注模式里（关闭，或切到了别的模式）；since 是进入当前模式的时刻，epoch 毫秒。
export type FocusNow = {
  mode: FocusMode | null;
  since: number | null;
  observedAt: number;
};

export const focusMirror = mirrorKey<FocusNow>(["iphone", "focus"]);

const MODE_NAMES: Record<string, FocusMode> = {
  正念: "mindfulness",
  mindfulness: "mindfulness",
  睡眠: "sleep",
  sleep: "sleep",
};

export function focusModeOf(name: string): FocusMode | null {
  return MODE_NAMES[name.trim().toLowerCase()] ?? null;
}

export function focusNow(state: FocusNow | null, now = Date.now()): FocusNow {
  if (!state?.mode || state.since == null || now - state.since >= FOCUS_MAX_MS) {
    return { mode: null, since: null, observedAt: state?.observedAt ?? 0 };
  }
  return state;
}
