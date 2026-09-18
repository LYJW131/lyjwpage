// 档位规则：确定性，按此刻算。Jev 不碰这一层 —— 它只对整段 24 小时窗口给活动分
// （见 src/lib/pulse-window.ts），档位仍由这里的规则决定。调用点只依赖 { level, hint } 的形状。

import { PULSE_HINT_MAX } from "@/lib/limits";
import type {
  ChargerStatus,
  NowListeningPayload,
  PlaystationPresencePayload,
  PulseLevel,
  VibeCodingNowPayload,
} from "@/lib/types";
import type { EmbyNowPlaying, StoredWatchingItem } from "@shared/emby-store";

/** 一次档位判定的结果。真正的「分」是 Jev 给窗口打的那个，见 types.ts 的 PulseScore。 */
export type PulseLevelResult = { level: PulseLevel; hint: string | null };

/**
 * 把若干段拼成 ≤48 字的 hint。整段能放下就用 ` – ` 拼；放不下就退回最后一段
 * （通常是更具体的那个名字）再截断。空段丢掉，全空则 null。
 */
export function compactHint(...parts: Array<string | null | undefined>): string | null {
  const cleaned = parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean);
  if (!cleaned.length) return null;
  const joined = cleaned.join(" – ");
  if (joined.length <= PULSE_HINT_MAX) return joined;
  const fallback = cleaned[cleaned.length - 1]!;
  return fallback.length <= PULSE_HINT_MAX ? fallback : fallback.slice(0, PULSE_HINT_MAX);
}

/**
 * 已知的 coding 应用。id 从 desktop-app-overrides 抄过来，再补上编辑器 / 终端；
 * 不从 .tsx 引用，避免把 React 拖进 Worker 和纯函数测试。
 */
const CODING_BUNDLE_IDS = new Set([
  "com.todesktop.230313mzl4w4u92",
  "com.mitchellh.ghostty",
  "com.microsoft.VSCode",
  "com.apple.dt.Xcode",
  "dev.zed.Zed",
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "dev.warp.Warp-Stable",
]);

export function isCodingApp(
  bundleIdentifier: string | null | undefined,
  applicationName: string | null | undefined,
): boolean {
  const id = bundleIdentifier?.trim() ?? "";
  if (id) {
    if (CODING_BUNDLE_IDS.has(id)) return true;
    const lower = id.toLowerCase();
    if (id.includes("230313mzl4w4u92") || lower.includes("cursor")) return true;
    if (lower.includes("antigravity")) return true;
    if (lower.includes("ghostty")) return true;
    if (lower.startsWith("com.jetbrains.")) return true;
    if (
      lower.includes("claude-code") ||
      lower.includes("claudecode") ||
      lower.includes("claude.code") ||
      lower.includes("com.anthropic.claude") ||
      lower.includes("claude")
    ) {
      return true;
    }
  }
  const name = applicationName?.trim().toLowerCase() ?? "";
  if (!name) return false;
  return (
    name.includes("cursor") ||
    name.includes("antigravity") ||
    name.includes("ghostty") ||
    name.includes("claude") ||
    name === "code" ||
    name === "visual studio code" ||
    name === "xcode" ||
    name === "zed" ||
    name === "terminal" ||
    name === "iterm" ||
    name === "iterm2" ||
    name === "warp"
  );
}

export function listeningLevel(payload: NowListeningPayload): PulseLevelResult {
  if (payload.idle || !payload.music) return { level: 0, hint: null };
  const hint = compactHint(payload.music.artist, payload.music.title);
  if (payload.music.state === "playing") return { level: 3, hint };
  if (payload.music.state === "paused") return { level: 2, hint };
  return { level: 0, hint: null };
}

export function watchingLevel(
  state: EmbyNowPlaying | null,
  item: StoredWatchingItem | null,
): PulseLevelResult {
  const hint = compactHint(item?.title);
  if (!state) return { level: 0, hint };
  if (state.paused) return { level: 2, hint };
  return { level: 3, hint };
}

export function gamingLevel(presence: PlaystationPresencePayload): PulseLevelResult {
  if (presence.playing != null) {
    return { level: 3, hint: compactHint(presence.playing.title) };
  }
  if (presence.online) return { level: 1, hint: null };
  return { level: 0, hint: null };
}

export function codingLevel(input: {
  agents: VibeCodingNowPayload["agents"] | null;
  desktop: { applicationName: string; bundleIdentifier: string | null } | null;
}): PulseLevelResult {
  const active = input.agents?.find((agent) => agent.active);
  if (active) {
    return { level: 3, hint: compactHint(active.currentModel || active.id) };
  }
  if (input.desktop && isCodingApp(input.desktop.bundleIdentifier, input.desktop.applicationName)) {
    return { level: 2, hint: compactHint(input.desktop.applicationName) };
  }
  return { level: 0, hint: null };
}

export function chargingLevel(status: ChargerStatus): PulseLevelResult {
  const activeDevice = status.ports.find((port) => port.active)?.device ?? null;
  const hint = compactHint(status.cover?.name ?? activeDevice);
  if (!status.connected) return { level: 0, hint };
  if (status.totalPower >= 60) return { level: 3, hint };
  if (status.totalPower >= 15) return { level: 2, hint };
  if (status.totalPower > 1 || status.ports.some((port) => port.active)) return { level: 1, hint };
  return { level: 0, hint };
}
