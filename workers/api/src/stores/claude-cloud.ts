import { applyOtlpUsage, claudeCloudNow } from "@/lib/claude-cloud-usage";
import { VIBECODING_TAG, type LiveEvent } from "@/lib/live-events";
import { fanout } from "@api/fanout";
import { claudeCloudUsageMirror } from "@shared/claude-cloud-usage";
import { nowMirror } from "@shared/vibecoding";
import type { PreparedClaudeCloudUsage } from "@shared/ingest/claude-cloud";

/**
 * 首屏快照最多这么久失效一次。云端线程干活时每分钟都有新用量，每封都失效会让
 * 首页缓存一直在重建；卡片挂载后自己定时来问，首屏晚几分钟无妨。
 */
const TAG_INTERVAL_MS = 5 * 60_000;

/**
 * 灯在浏览器按 5 分钟窗口现算，推送只是让它立刻亮。时刻往前走了大半分钟、或换了模型才推：
 * exporter 每分钟一轮，时刻差在 60 秒上下抖，门槛留点余量；卡片自己定时来问，漏一条也会跟上。
 */
const PUSH_STEP_MS = 45_000;

/** StateHub 阶段：累计值做差要拿权威的上一次值。解析在上报入口，见 shared/ingest/claude-cloud.ts。 */
export async function recordPreparedClaudeCloudUsage(prepared: PreparedClaudeCloudUsage) {
  const { points, receivedAt } = prepared;
  if (points.length === 0) return { accepted: 0 };
  const previous = await claudeCloudUsageMirror.get();
  const { usage, changed } = applyOtlpUsage(previous?.usage ?? null, points, receivedAt);
  const tag = changed && receivedAt - (previous?.taggedAt ?? 0) >= TAG_INTERVAL_MS;
  const before = previous?.usage ?? null;
  const moved = usage.lastPointAt != null &&
    (before?.lastPointAt == null || usage.lastPointAt - before.lastPointAt >= PUSH_STEP_MS || usage.lastModel !== before.lastModel);
  const events: LiveEvent[] = [];
  if (moved) {
    // 整行推：Mac 那个电平和时刻照抄权威值，浏览器并进来不会被这条冲掉
    const local = (await nowMirror.get())?.payload.agents.find((agent) => agent.id === "claude") ?? null;
    const now = claudeCloudNow(usage, local);
    events.push({
      type: "vibecoding-now",
      payload: { agents: [{
        id: "claude",
        currentModel: now.currentModel,
        lastActivityAt: local?.lastActivityAt ?? null,
        active: local?.active ?? false,
        cloudActivityAt: now.cloudActivityAt,
      }] },
    });
  }
  await fanout({
    writes: [claudeCloudUsageMirror.put({
      usage,
      pushedAt: receivedAt,
      taggedAt: tag ? receivedAt : previous?.taggedAt ?? null,
    })],
    events,
    tags: tag ? [VIBECODING_TAG] : [],
  });
  return { accepted: points.length };
}
