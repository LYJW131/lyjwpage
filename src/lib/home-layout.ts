import type { ChargerStatus, CodingUsagePayload, LocalNowPlaying, PowerBankStatus } from "@/lib/types";


export const CHARGING_IDLE_MAX_W = 1;

export function chargerActive(status: Pick<ChargerStatus, "connected" | "totalPower"> | null | undefined): boolean {
  return Boolean(status?.connected && status.totalPower > CHARGING_IDLE_MAX_W);
}

// 涓流时输入功率可能低于阈值，充电状态必须信固件标志。
export function powerBankActive(
  status: Pick<PowerBankStatus, "connected" | "charging" | "outputPower"> | null | undefined,
): boolean {
  return Boolean(status?.connected && (status.charging || status.outputPower > 1));
}

export function liveTrack<T extends Pick<LocalNowPlaying, "title" | "state">>(music: T | null | undefined): T | null {
  return music?.title && music.state !== "stopped" ? music : null;
}

export function codingLayoutKey(payload: Pick<CodingUsagePayload, "agents" | "totals" | "topModels"> | null): string {
  if (!payload) return "unavailable";
  return JSON.stringify({
    agents: payload.agents.map((agent) => agent.id).sort(),
    totals: payload.totals != null,
    topModels: payload.topModels.length > 0,
  });
}

export function workoutsLayoutKey(payload: { items: readonly unknown[] } | null): "none" | "empty" | "list" {
  if (!payload) return "none";
  return payload.items.length ? "list" : "empty";
}

export function genshinLayoutKey(payload: object | null | undefined): "none" | "card" {
  return payload ? "card" : "none";
}
