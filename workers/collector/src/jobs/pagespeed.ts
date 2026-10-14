import { LAG_KEYS, writeLag } from "@shared/lag";
import { get, put } from "@shared/cache";
import { DEVICES, fetchPageSpeed, mergePageSpeed, type Device } from "../pagespeed";
import { site } from "@shared/site";
import type { LighthouseVitals, PageSpeedSample } from "@shared/site-deployments-types";

import { explain, ok, skipMissing, type Job } from "../job";

const HISTORY_KEY = `pagespeed:history:v1:${site.url}`;
const HISTORY_TTL_MS = 24 * 3_600_000;

type Fetch = (url: string, strategy: Device, key: string) => Promise<LighthouseVitals>;

export async function refreshPageSpeed(key: string, lag: KVNamespace, now = Date.now(), fetch: Fetch = fetchPageSpeed) {
  const started = Date.now();
  const runs = await Promise.all(DEVICES.map(async (device) => {
    try {
      return { device, vitals: await fetch(site.url, device, key), ms: Date.now() - started };
    } catch (error) {
      return { device, vitals: null, error: explain(error), ms: Date.now() - started };
    }
  }));
  const failed = runs.filter((run) => !run.vitals);
  const detail = failed.map((run) => `${run.device} ${run.error} (${run.ms}ms)`).join("; ");
  if (failed.length === runs.length) throw new Error(detail);
  const [desktop, mobile] = runs.map((run) => run.vitals);
  const { history, payload } = mergePageSpeed(await get(HISTORY_KEY), { at: now, desktop, mobile });
  await put<PageSpeedSample[]>(HISTORY_KEY, history, HISTORY_TTL_MS);
  if (!payload) throw new Error(`窗口里还没有 ${failed[0].device} 样本`);
  // 用两端里较旧的那次实测当写入时刻，一端一直测不出时 freshness-watch 照样按它报过期。
  await writeLag(lag, LAG_KEYS.pagespeed, payload, payload.fetchedAt);
  if (failed.length) console.warn(JSON.stringify({ event: "collector-job", job: "pagespeed", status: "partial", detail }));
  return ok([`${history.length} samples`, ...runs.map((run) => `${run.device} ${run.vitals ? "ok" : "failed"} ${run.ms}ms`)].join(", "));
}

export const pagespeedJob: Job = {
  name: "pagespeed",
  everyMinutes: 60,
  offset: 7,
  async run({ env }) {
    const key = env.PAGESPEED_API_KEY?.trim();
    if (!key) return skipMissing("pagespeed", ["PAGESPEED_API_KEY"]);
    return refreshPageSpeed(key, env.LAG);
  },
};
