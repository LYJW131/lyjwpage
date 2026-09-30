import { LAG_KEYS, writeLag } from "@shared/lag";
import { get, put } from "@/lib/cache";
import { fetchPageSpeed, mergePageSpeed } from "@/lib/pagespeed";
import { site } from "@/lib/site";
import type { PageSpeedSample } from "@/lib/vercel-deployments-types";

import { ok, skipMissing, type Job } from "../job";

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
