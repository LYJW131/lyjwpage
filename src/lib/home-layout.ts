import type { ChargerStatus, LocalNowPlaying, PowerBankStatus, VibeCodingPayload } from "@/lib/types";

/**
 * 首屏布局的判据，页面和 Worker 共用一份。
 *
 * 首页每张卡一个 `'use cache'` 条目，tag 失效时那张卡回源、整页在后台重建（见
 * lib/first-screen）。上报侧只在**布局**变了时发 tag：卡片出现 / 消失、换形态、
 * 行数变了。数字、标题、进度这类内容变化交给 `revalidate: 600` 的定时重建 ——
 * 浏览器挂载后本来就会直接问 Worker 取最新，首屏 HTML 旧几分钟只影响第一帧里
 * 的数字。
 *
 * 判据写在这里而不是各自抄一份：组件改了阈值，Worker 这侧跟着变。
 */

/**
 * 这个瓦数以下算待机：插着线、没真在充时，读数在 0 和零点几瓦之间来回跳。
 * 充电头这一格和 Pulse 充电泳道的「通电 / 断电」共用这一个门槛。
 */
export const CHARGING_IDLE_MAX_W = 1;

/**
 * 充电头这一格亮不亮（media-pair 按它排版）。
 *
 * 只看传进来的 connected：Worker 入库时拿原样的状态比布局有没有变；浏览器那侧
 * 传进来的是先过了 liveChargingFeed（lib/freshness）的那份，掉线 / 断流已经盖成
 * connected: false。
 */
export function chargerActive(status: Pick<ChargerStatus, "connected" | "totalPower"> | null | undefined): boolean {
  return Boolean(status?.connected && status.totalPower > CHARGING_IDLE_MAX_W);
}

/**
 * 充电宝这一格亮不亮：在收或在放。大部分时间它插着但不收不放，那种状态不占格子。
 * 进电看固件的 `charging` 而不是输入功率 —— 涓流时功率压在阈值下，灯却是亮的。
 * connected 的口径同上面的 chargerActive。
 */
export function powerBankActive(
  status: Pick<PowerBankStatus, "connected" | "charging" | "outputPower"> | null | undefined,
): boolean {
  return Boolean(status?.connected && (status.charging || status.outputPower > 1));
}

/** 这份播放状态能不能顶上正在听的 hero；不能时退回最近播放 */
export function liveTrack<T extends Pick<LocalNowPlaying, "title" | "state">>(music: T | null | undefined): T | null {
  return music?.title && music.state !== "stopped" ? music : null;
}

/**
 * Vibe coding 卡片的骨架：精简列表按 agent 逐行排、没有上限，总量和常用模型
 * 两块有无各占一段高度。用量数字、限额百分比、活动灯都不在里面。
 */
export function vibeCodingLayoutKey(payload: Pick<VibeCodingPayload, "agents" | "totals" | "topModels"> | null): string {
  if (!payload) return "unavailable";
  return JSON.stringify({
    agents: payload.agents.map((agent) => agent.id).sort(),
    totals: payload.totals != null,
    topModels: payload.topModels.length > 0,
  });
}

/**
 * 训练条目那一块的骨架：还没收到过、收到了但一条都读不出、有训练，三种各是一块不同的
 * 占位。有几条、是哪几条都只是内容（条目横向翻页、定高）。圆环卡读数变化、从没有到有
 * 都画在同一个骨架里，不需要判据。
 */
export function workoutsLayoutKey(payload: { items: readonly unknown[] } | null): "none" | "empty" | "list" {
  if (!payload) return "none";
  return payload.items.length ? "list" : "empty";
}
