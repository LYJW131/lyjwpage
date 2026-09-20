import { site } from "@/lib/site";
import { workoutDuration } from "@/lib/workout-display";
import type { VercelDeploymentsPayload } from "@/lib/vercel-deployments-types";
import type {
  PlaystationPlayingPayload,
  TrophiesSummaryPayload,
  WorkoutsPayload,
} from "@/lib/types";
import type { WatchingPayload } from "@shared/emby";

/**
 * 时间线：把各张卡已经有的带时刻条目并成一条按时间倒序的流水。
 *
 * **不是新的一路数据。** 这里只做投影：看过的剧、玩过的游戏、解锁的奖杯、练过的
 * 训练、上线的部署，每一条的事实都已经在 `/api/home` 里了。所以既不加 ingest、不加
 * 存储，也不加 `/api/status/timeline` —— 那样只会把同一批字节在首屏 HTML 里再塞一遍。
 * 卡片那侧读的是各来源自己的 SWR 键，推送来了两处一起变，不会各说各话。
 *
 * 「最近在听」进不来：`ListeningItem` 是有序列表、没有单条播放时刻
 * （只有整份的 `fetchedAt`），而 pulse 里那份带时刻的 hint 按设计不出公网。
 * 最近提交也进不来：它在站点侧按 `cacheLife("max")` 焊进 HTML（见
 * lib/github-recent-commits），浏览器这侧拿不到，混进来会在挂载刷新后消失。
 * 部署那条带着提交信息，已经能代表「这阵子在写什么」。
 *
 * 时刻一律换算成 epoch 毫秒，日期一律按站点时区 `site.timezone` 分天 —— 训练条目
 * 自带 `secondsFromGMT`（训练卡用的是那个），在这条流水里不用，否则出门那几天
 * 的条目会插到别的日子里去。这是有意的取舍，两处显示的钟点可能不同。
 */

export const TIMELINE_KINDS = ["watch", "play", "trophy", "workout", "deploy"] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export type TimelineEvent = {
  /** `<kind>:<来源侧标识>`，同一轮里去重用 */
  id: string;
  kind: TimelineKind;
  /** epoch 毫秒 */
  at: number;
  title: string;
  /** 次要一行，没有就不画 */
  subtitle: string | null;
  /**
   * 缩略图。Emby 的海报是同源 `/img/<对象键>`，PSN 的封面和奖杯图是源站直链
   * （尺寸怎么选见 lib/playstation-image）；没有图的类别画图标。
   */
  imageUrl: string | null;
  /** 缩略图是竖版海报（Emby 剧集）还是方图 */
  portrait: boolean;
  /** 行尾那一小格：进度、时长、杯种 */
  meta: string | null;
  link: string | null;
};

/**
 * 各来源的 payload。`undefined` = 那一路还没到或降级了（`useStatus` 在信封
 * `ok:false` 时给的就是 `undefined`），跳过它，其余照常并。
 */
export type TimelineSources = {
  watching?: WatchingPayload;
  playing?: PlaystationPlayingPayload;
  trophies?: TrophiesSummaryPayload;
  workouts?: WorkoutsPayload;
  deployments?: VercelDeploymentsPayload;
};

/** 一屏之外的没人看，过长的列表只是白占内存 */
export const TIMELINE_LIMIT = 30;

/**
 * 往回收多久。
 *
 * 「最近在玩」那份列表里的 `lastPlayedAt` 是这款游戏**有史以来**最后一次开的时刻，
 * 半年前打过一轮的也在列；不切窗的话 30 格会被几个月前的日子填满，时间线就成了
 * 游戏库的排序。
 *
 * 窗口锚在**最新那条**上，不是 `Date.now()`：这份合并在客户端组件里跑，服务端
 * 预渲染那一遍和浏览器水合那一遍的钟对不上，拿当下切窗会水合不一致（同理见
 * hooks/use-mounted-at）。代价是真的停更一个月时，卡片画的是上一次活跃的那几天
 * 而不是空 —— 对一张「最近干了什么」的卡来说，这比空着更有用。
 */
export const TIMELINE_WINDOW_MS = 30 * 86_400_000;

/** epoch 毫秒；认不出的时刻（null、空串、非法 ISO）返回 null，不糊一个「现在」上去 */
function epochMs(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function firstLine(message: string): string {
  return message.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function watchEvents(payload: WatchingPayload | undefined): TimelineEvent[] {
  if (!payload) return [];
  return payload.items.flatMap((item) => {
    const at = epochMs(item.playedAt);
    if (at == null) return [];
    // 进度只在「看了一半」时有意义：0 和 100 两头不画
    const progress = item.progress > 0 && item.progress < 100 ? `${Math.round(item.progress)}%` : null;
    return [{
      id: `watch:${item.id}`,
      kind: "watch" as const,
      at,
      title: item.title,
      subtitle: item.subtitle || (item.year == null ? null : String(item.year)),
      imageUrl: item.poster ?? item.backdrop,
      portrait: item.poster != null,
      meta: progress,
      link: item.link,
    }];
  });
}

function playEvents(payload: PlaystationPlayingPayload | undefined): TimelineEvent[] {
  if (!payload) return [];
  return payload.items.flatMap((game) => {
    const at = epochMs(game.lastPlayedAt);
    if (at == null) return [];
    return [{
      id: `play:${game.titleId}`,
      kind: "play" as const,
      at,
      title: game.name,
      subtitle: null,
      imageUrl: game.imageUrl,
      portrait: false,
      // 累计游玩次数和总时长是这款游戏的生平，不是这一次的事，留在 PlayStation 卡里
      meta: null,
      link: null,
    }];
  });
}

function trophyEvents(payload: TrophiesSummaryPayload | undefined): TimelineEvent[] {
  if (!payload) return [];
  return payload.recent.flatMap((unlock) => {
    const at = epochMs(unlock.earnedAt);
    if (at == null) return [];
    return [{
      // 同一款游戏里奖杯会重名，坐标是三件一套（见 TrophyUnlock 的注释）
      id: `trophy:${unlock.npCommunicationId}:${unlock.groupId}:${unlock.id}`,
      kind: "trophy" as const,
      at,
      title: unlock.trophyName,
      subtitle: unlock.titleName,
      imageUrl: unlock.iconUrl,
      portrait: false,
      meta: unlock.type,
      link: null,
    }];
  });
}

function workoutEvents(payload: WorkoutsPayload | undefined): TimelineEvent[] {
  if (!payload) return [];
  return payload.items.flatMap((workout) => {
    const at = epochMs(workout.startedAt);
    if (at == null) return [];
    return [{
      id: `workout:${workout.id}`,
      kind: "workout" as const,
      at,
      title: workout.activityType,
      subtitle: workout.indoor == null ? null : workout.indoor ? "Indoor" : "Outdoor",
      imageUrl: null,
      portrait: false,
      meta: workoutDuration(workout.durationSeconds),
      link: null,
    }];
  });
}

/**
 * 只收生产环境里真的上线了的那几次。
 *
 * 预览构建一天能有十几次，和「看了什么、玩了什么」摆在一条流水里会把别的挤没；
 * 失败和取消的那几次属于构建记录，站点状态卡里有，不该冒充一次发布。
 */
function deployEvents(payload: VercelDeploymentsPayload | undefined): TimelineEvent[] {
  if (!payload) return [];
  const seen = new Set<string>();
  const all = [...(payload.production ? [payload.production] : []), ...payload.recent];
  return all.flatMap((deployment) => {
    if (deployment.target !== "production" || deployment.state !== "READY") return [];
    if (seen.has(deployment.id)) return [];
    seen.add(deployment.id);
    const at = epochMs(deployment.createdAt);
    if (at == null) return [];
    const message = deployment.commit?.message ? firstLine(deployment.commit.message) : "";
    const sha = deployment.commit?.sha?.slice(0, 7) ?? null;
    return [{
      id: `deploy:${deployment.id}`,
      kind: "deploy" as const,
      at,
      title: message || "Production deployment",
      subtitle: sha,
      imageUrl: null,
      portrait: false,
      meta: deployment.buildDurationMs == null
        ? null
        : `${Math.round(deployment.buildDurationMs / 1000)}s`,
      link: `${site.vercel}/${deployment.id}`,
    }];
  });
}

/**
 * 各来源并成一条流水：时间倒序，同 id 去重（保留时刻较新的那条），按
 * `windowMs` 从最新那条往回切窗，再截到 `limit`。
 *
 * 所有来源都缺席时返回空数组 —— 这和「最近什么都没发生」在页面上是同一种样子，
 * 由调用方拿各信封的 ok 自己区分「还没收到」和「真的没有」。
 */
export function composeTimeline(
  sources: TimelineSources,
  { limit = TIMELINE_LIMIT, windowMs = TIMELINE_WINDOW_MS }: { limit?: number; windowMs?: number } = {},
): TimelineEvent[] {
  const events = [
    ...watchEvents(sources.watching),
    ...playEvents(sources.playing),
    ...trophyEvents(sources.trophies),
    ...workoutEvents(sources.workouts),
    ...deployEvents(sources.deployments),
  ];

  const byId = new Map<string, TimelineEvent>();
  for (const event of events) {
    const previous = byId.get(event.id);
    if (!previous || event.at > previous.at) byId.set(event.id, event);
  }

  const sorted = [...byId.values()].sort((a, b) => b.at - a.at);
  const newest = sorted[0]?.at;
  if (newest == null) return [];
  return sorted.filter((event) => event.at >= newest - windowMs).slice(0, limit);
}

const dayKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: site.timezone });
const dayLabelFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: site.timezone,
  weekday: "short",
  month: "short",
  day: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: site.timezone,
  hour: "numeric",
  minute: "2-digit",
});

/** 某个时刻落在站点时区的哪一天，`YYYY-MM-DD` */
export function timelineDayKey(at: number): string {
  return dayKeyFormat.format(at);
}

/** 行首的钟点，`11:00 AM`（站点时区） */
export function timelineTime(at: number): string {
  return timeFormat.format(at);
}

/**
 * 分组标题。今天和昨天按站点时区认，再往前给 `Mon, Sep 15`。
 * `now` 由调用方给：首帧没有「当下」（见 hooks/use-mounted-at），
 * 传 0 时一律走绝对日期。
 */
export function timelineDayLabel(dayKey: string, now: number): string {
  if (now) {
    if (dayKey === timelineDayKey(now)) return "Today";
    if (dayKey === timelineDayKey(now - 86_400_000)) return "Yesterday";
  }
  // 日期字符串按 UTC 解析、再按站点时区格式化会差一个时区。取那一天的 UTC 正午：
  // 偏移在 ±12 小时以内的时区里都还落在同一天，站点时区（UTC+8）自然在内。
  return dayLabelFormat.format(Date.parse(`${dayKey}T12:00:00Z`));
}

export type TimelineDay = { key: string; events: TimelineEvent[] };

/** 已排序的流水按天分组，组内保持倒序 */
export function groupTimelineByDay(events: TimelineEvent[]): TimelineDay[] {
  const days: TimelineDay[] = [];
  for (const event of events) {
    const key = timelineDayKey(event.at);
    const last = days[days.length - 1];
    if (last?.key === key) last.events.push(event);
    else days.push({ key, events: [event] });
  }
  return days;
}
