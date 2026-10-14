import { LAG_KEYS, writeLag } from "@shared/lag";
import { fetchSiteAnalytics, parseSiteAnalyticsSources } from "@shared/site-analytics";
import { fetchSiteDeployments } from "@shared/site-deployments";

import { archiveSiteDeploys } from "../history";
import { ok, settings, skipMissing, type Job } from "../job";

const SITE_DEPLOYMENTS_SETTINGS = ["CLOUDFLARE_METRICS_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "SITE_WORKER_TAG"] as const;
const SITE_ANALYTICS_SETTINGS = ["CLOUDFLARE_METRICS_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "SITE_ANALYTICS_SITES"] as const;

export const siteDeploymentsJob: Job = {
  name: "site-deployments",
  everyMinutes: 1,
  offset: 0,
  async run({ env, now }) {
    const config = settings(env, SITE_DEPLOYMENTS_SETTINGS);
    if ("missing" in config) return skipMissing("site-deployments", config.missing);
    const { CLOUDFLARE_METRICS_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, SITE_WORKER_TAG: scriptTag } = config.values;
    const data = await fetchSiteDeployments(account, scriptTag, token, now);
    await writeLag(env.LAG, LAG_KEYS.siteDeployments, data, data.fetchedAt);
    if (env.HISTORY) await archiveSiteDeploys(env.HISTORY, [data.production, ...data.recent], data.fetchedAt);
    return ok();
  },
};

export const siteAnalyticsJob: Job = {
  name: "site-analytics",
  everyMinutes: 15,
  offset: 3,
  async run({ env, now }) {
    const config = settings(env, SITE_ANALYTICS_SETTINGS);
    if ("missing" in config) return skipMissing("site-analytics", config.missing);
    const { CLOUDFLARE_METRICS_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, SITE_ANALYTICS_SITES: sitesJson } = config.values;
    const data = await fetchSiteAnalytics(account, token, parseSiteAnalyticsSources(sitesJson), now);
    await writeLag(env.LAG, LAG_KEYS.siteAnalytics, data, data.fetchedAt);
    return ok();
  },
};
