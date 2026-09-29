import type { LiveEvent } from "@/lib/live-events";
import { fanout } from "@api/fanout";
import { recordCursorObservation } from "@api/stores/pulse-source-observations";
import type { PreparedAgentLimits } from "@shared/ingest/agents";

import { prepareCodingActivity, readCodingActivities } from "./coding-activity";
import { prepareCodingBuckets } from "./coding-buckets";
import { prepareCodingUsage } from "./coding-usage";

/**
 * `/api/ingest/agents` 的状态核心那一半：三份 coding 数据（眼下只有 Cursor）。限额在可滞后层，
 * 由上报入口直接写 KV（workers/ingress 的 lag-ingest），不进这里；收敛见 shared/ingest/agents.ts。
 *
 * 另外给 Pulse 记一笔 Cursor 账号观测（`pulse:cursor-observations`，Coding 三色带与 Jev 的独立来源）：
 * 用量历史采集成功就是一次心跳（时刻取采集时刻，重放旧报告救不活覆盖）；只有活动的那封，
 * 时刻往前走了才记。
 */
export async function commitPreparedAgentsReport(prepared: PreparedAgentLimits) {
  const { limits, receivedAt, codingUsage, codingActivity, codingTokenBuckets } = prepared;
  const writes: Promise<unknown>[] = [];
  const events: LiveEvent[] = [];
  const tags: string[] = [];

  if (codingUsage) {
    const landing = await prepareCodingUsage("agents", codingUsage, receivedAt);
    writes.push(landing.commit());
    tags.push(...landing.tags);
  }

  let storedActivity = null;
  if (codingActivity) {
    const landing = await prepareCodingActivity("agents", codingActivity, receivedAt);
    storedActivity = landing.previous;
    if (landing.accepted) writes.push(landing.commit());
    if (landing.event) events.push(landing.event);
  } else if (codingUsage?.agents.some((agent) => agent.id === "cursor")) {
    storedActivity = (await readCodingActivities()).agents ?? null;
  }

  if (codingTokenBuckets) {
    const landing = await prepareCodingBuckets("agents", codingTokenBuckets, receivedAt);
    if (landing.accepted) writes.push(landing.commit());
  }

  const usage = codingUsage?.agents.find((agent) => agent.id === "cursor");
  const activity = codingActivity?.agents.find((agent) => agent.id === "cursor");
  const before = storedActivity?.agents.find((agent) => agent.id === "cursor")?.lastActivityAt ?? null;
  const advanced = activity?.lastActivityAt != null && (before == null || activity.lastActivityAt > before);
  if (usage || advanced) {
    const t = usage ? usage.collectedAt : receivedAt;
    if (t != null && t <= receivedAt + 60_000) {
      writes.push(recordCursorObservation({
        t: Math.min(t, receivedAt),
        available: usage ? usage.state === "ok" && !usage.warning : true,
        lastActivityAt: activity?.lastActivityAt ?? before,
      }));
    }
  }

  await fanout({ writes, events, tags });
  return {
    accepted: limits?.agents.length ?? 0,
    codingUsage: Boolean(codingUsage),
    codingActivity: Boolean(codingActivity),
    codingTokenBuckets: Boolean(codingTokenBuckets),
  };
}
