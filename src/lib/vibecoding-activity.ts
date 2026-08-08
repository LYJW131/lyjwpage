import { VIBECODING_ACTIVITY_LIMIT } from "@/lib/limits";
import type { VibeCodingAgent, VibeCodingPayload } from "@/lib/types";

/**
 * vibe coding 活动曲线的客户端累加器。
 *
 * 和 charger-history 是同一个模式：曲线增量拉，每次只问服务端要 `?since=`
 * 之后的桶，本地拼成完整序列。从组件的 ref 提到模块级，是为了和充电头共用
 * use-status 里那个 incrementalFetcher —— 游标和合并都是模块级函数，壳子才
 * 能在模块作用域构造出来、天然是稳定引用，不用每个卡片自己 useCallback。
 *
 * 整个页面只有一张 vibe coding 卡，单例不会串。
 */

const activity = new Map<string, VibeCodingAgent["activity"]>();

/**
 * 下次增量拉取的游标。
 *
 * 各 agent 的桶边界是对齐的，取其中最新的那个当水位线就够。空表返回 null
 * 表示要整份。
 */
export function activityCursor(): number | null {
  let since: number | null = null;
  for (const points of activity.values()) {
    const newest = points[points.length - 1]?.t;
    if (newest != null && (since == null || newest > since)) since = newest;
  }
  return since;
}

/**
 * 把一份响应并进本地序列，返回带完整曲线的那份。
 *
 * `activityPartial` 为假就是整份快照（首次请求，或落后太多、最旧的桶都滚出
 * 窗口了），直接替换；为真才是增量。
 *
 * 增量按 `t` 合并而不是直接追加：边界那个桶还在累加，同一个 t 会带着新值再来
 * 一次，必须覆盖旧值，否则曲线末端会多出一根重复的柱子。
 */
export function mergeVibeCodingActivity(payload: VibeCodingPayload): VibeCodingPayload {
  const agents = payload.agents.map((agent) => {
    if (!payload.activityPartial) {
      activity.set(agent.id, agent.activity);
      return agent;
    }
    const merged = new Map(
      (activity.get(agent.id) ?? []).map((point) => [point.t, point] as const),
    );
    for (const point of agent.activity) merged.set(point.t, point);
    const next = [...merged.values()]
      .sort((a, b) => a.t - b.t)
      .slice(-VIBECODING_ACTIVITY_LIMIT);
    activity.set(agent.id, next);
    return { ...agent, activity: next };
  });
  return { ...payload, agents };
}
