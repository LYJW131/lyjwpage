import { cloudflareApi, fetchErrorSeries, fetchFieldVitals } from "@shared/health-cloudflare";
import {
  HEARTBEAT_SERIES,
  SITE_UPTIME_URL,
  UPTIME_PROBE_EVERY_MINUTES,
  UPTIME_SERIES,
  mergeHealth,
  pruneChecks,
  readBuckets,
  summarizeBuckets,
} from "@shared/health";
import type { HealthBlock, HealthPayload } from "@shared/health-types";
import { LAG_KEYS, readLag, writeLag } from "@shared/lag";
import { parseSiteAnalyticsSources } from "@shared/site-analytics";

import { explain, ok, settings, skipMissing, type Job } from "../job";

const SITE_HEALTH_SETTINGS = ["CLOUDFLARE_METRICS_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "SITE_ANALYTICS_SITES"] as const;

export const siteHealthJob: Job = {
  name: "site-health",
  everyMinutes: 5,
  offset: 4,
  async run({ env, now }) {
    if (!env.HISTORY) return skipMissing("site-health", ["HISTORY"]);
    const config = settings(env, SITE_HEALTH_SETTINGS);
    if ("missing" in config) return skipMissing("site-health", config.missing);
    const { CLOUDFLARE_METRICS_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, SITE_ANALYTICS_SITES: sitesJson } = config.values;
    const db = env.HISTORY;
    const api = cloudflareApi(token);
    const failed: string[] = [];
    const settle = <T>(block: HealthBlock, promise: Promise<T>) => promise.catch((error: unknown) => {
      failed.push(block);
      console.warn(JSON.stringify({ event: "site-health", block, error: explain(error) }));
      return null;
    });
    const [uptime, heartbeat, errors, vitals] = await Promise.all([
      settle("uptime", readBuckets(db, UPTIME_SERIES, now).then((buckets) => ({
        ...summarizeBuckets(UPTIME_SERIES, buckets, now),
        url: SITE_UPTIME_URL,
        intervalSeconds: UPTIME_PROBE_EVERY_MINUTES * 60,
      }))),
      settle("heartbeat", readBuckets(db, HEARTBEAT_SERIES, now).then((buckets) => summarizeBuckets(HEARTBEAT_SERIES, buckets, now))),
      settle("errors", fetchErrorSeries(api, account, now)),
      settle("vitals", fetchFieldVitals(api, account, parseSiteAnalyticsSources(sitesJson).map((site) => site.siteTag), now)),
    ]);
    if (failed.length === 4) throw new Error("健康检查全部查询失败");
    const next: HealthPayload = { fetchedAt: now, uptime, heartbeat, errors, vitals };
    const previous = (await readLag<HealthPayload>(env.LAG, LAG_KEYS.health))?.data ?? null;
    await writeLag(env.LAG, LAG_KEYS.health, mergeHealth(next, previous), now);
    await pruneChecks(db, now);
    return ok(failed.length ? `${failed.join(", ")} carried over` : undefined);
  },
};
