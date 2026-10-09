import type { NowWatchingPayload, WatchingPayload } from "@/lib/emby";
import type { QuestNow } from "@shared/quest";
import type {
  ChargerPayload,
  CodingNowPayload,
  DesktopPayload,
  ListeningPayload,
  NowListeningPayload,
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  TrophiesSummaryPayload,
  PowerBankPayload,
} from "@/lib/types";


export type LiveEvent =
  | { type: "quest-now"; payload: QuestNow }
  | { type: "desktop"; payload: DesktopPayload }
  | { type: "listening-now"; payload: NowListeningPayload }
  | { type: "listening"; payload: ListeningPayload }
  // 广播不知道各客户端游标；历史使用空增量，不能用空全量覆盖已有曲线。
  | { type: "charger"; payload: ChargerPayload }
  | { type: "powerbank"; payload: PowerBankPayload }
  | { type: "coding-now"; payload: CodingNowPayload }
  // 不带数据的失效通知必须在写入完成后发布，避免客户端回源读到旧值。
  | { type: "presence"; payload: null }
  | { type: "version"; payload: null }
  | { type: "online"; payload: { online: number } }
  | { type: "watching-now"; payload: NowWatchingPayload }
  | { type: "watching"; payload: WatchingPayload }
  | { type: "playing-now"; payload: PlaystationPresencePayload }
  | { type: "playing"; payload: PlaystationPlayingPayload }
  | { type: "trophies"; payload: TrophiesSummaryPayload };

export {
  ACTIVITY_TAG,
  CHARGER_TAG,
  CODING_NOW_TAG,
  CODING_TAG,
  CODING_YEAR_TAG,
  DESKTOP_TAG,
  LIMITS_TAG,
  LISTENING_TAG,
  NOW_LISTENING_TAG,
  NOW_PLAYING_TAG,
  NOW_WATCHING_TAG,
  PLAYING_TAG,
  POWERBANK_TAG,
  QUEST_NOW_TAG,
  SERVER_TAG,
  STATUS_TAGS,
  TIMEZONE_TAG,
  TROPHIES_TAG,
  WATCHING_TAG,
} from "@/lib/status-tags";
