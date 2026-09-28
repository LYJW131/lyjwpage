import { LAG_KEYS, writeLag } from "@shared/lag";
import { get, put } from "@/lib/cache";
import { fetchPageSpeed, mergePageSpeed } from "@/lib/pagespeed";
import { site } from "@/lib/site";
import type { PageSpeedSample } from "@/lib/vercel-deployments-types";

import { ok, skipMissing, type Job } from "../job";

/**
 * PageSpeed Insights 实验室分，每小时第 7 分钟一轮：桌面、移动并行测（各二三十秒，
 * 一起跑墙钟一分半上下，cron 的墙钟上限是 15 分钟，放得下），合成一个样本并进
 * 6 小时滚动窗口，逐格取中位数写可滞后层。
 *
 * 窗口样本存在 COLLECTOR_KV（经 src/lib/cache）。任一端失败这一轮就不写，窗口和
 * 可滞后层都保持上一轮的样子；下一小时再来。密钥只进查询参数，日志里只有状态码。
 */
const HISTORY_KEY = `pagespeed:history:v1:${site.url}`;
const HISTORY_TTL_MS = 24 * 3_600_000;

export async function refreshPageSpeed(key: string, lag: KVNamespace, now = Date.now()) {
  const [desktop, mobile] = await Promise.all([
    fetchPageSpeed(site.url, "desktop", key),
    fetchPageSpeed(site.url, "mobile", key),
  ]);
  const { history, payload } = mergePageSpeed(await get(HISTORY_KEY), { at: now, desktop, mobile });
  await put<PageSpeedSample[]>(HISTORY_KEY, history, HISTORY_TTL_MS);
  await writeLag(lag, LAG_KEYS.pagespeed, payload, now);
  return ok(`${history.length} samples`);
}

export const pagespeedJob: Job = {
  name: "pagespeed",
  everyMinutes: 60,
  offset: 7,
  maxRuntimeMinutes: 4,
  async run({ env }) {
    const key = env.PAGESPEED_API_KEY?.trim();
    if (!key) return skipMissing("pagespeed", ["PAGESPEED_API_KEY"]);
    return refreshPageSpeed(key, env.LAG);
  },
};
