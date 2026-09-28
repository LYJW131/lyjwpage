import { AwaitingReport } from "@/lib/awaiting-report";
import { getPlaystationPlayedGames, getPlaystationPower, getPlaystationPresence } from "@/lib/playstation-store";
import type {
  PlaystationPlayingPayload,
  PlaystationPresencePayload
} from "@/lib/types";

export async function getPlaying(): Promise<PlaystationPlayingPayload> {
  const payload = await getPlaystationPlayedGames();
  if (!payload) throw new AwaitingReport("尚未收到 PlayStation 最近游玩遥测");
  return payload;
}

/**
 * presence 是心跳：Worker 每轮 cron 都发一封，内容没变也发，于是 observedAt 多久
 * 没动就是「Worker 还活着没有」。这个判定光靠时间流逝就会翻面，所以源站**不判**，
 * 原样把最后那份连同 observedAt 交出去，由浏览器拿自己的钟和 PLAYSTATION_STALE_MS
 * 比（playstation-card / playstation-panel）。源站判的话，结论会跟着首屏缓存冻住。
 *
 * 断流不等于离线：Worker 死了我们只是**不知道**他在不在玩。卡片照旧摆最近在玩的
 * 瓷砖、只是不再有「正在游玩」那一格和头像那颗状态点 —— 而不是伪造一个
 * online:false 说他下线了。
 */
export async function getPlayingNow(): Promise<PlaystationPresencePayload> {
  /**
   * 电源是 HA 单独上报、单独存的一份，读的时候才并进来：PSN 上报器每轮整份覆盖
   * presence，写在一起会被它冲掉。没收到过 HA 的上报时这一项是 null。
   */
  const [payload, power] = await Promise.all([
    getPlaystationPresence(),
    getPlaystationPower(),
  ]);
  if (!payload) throw new AwaitingReport("尚未收到 PlayStation 在线状态遥测");
  return { ...payload, power: power ?? null };
}
export { normalizePlaystationPlayedGames, normalizePlaystationPresence } from "@shared/playstation";
