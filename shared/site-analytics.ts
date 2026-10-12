export const SITE_ANALYTICS_HOSTS = ["lyjw.me", "lyjw131.com"] as const;

export type SiteAnalyticsSource = { host: string; siteTag: string };
export type SiteAnalyticsPayload = {
  fetchedAt: number;
  start: number;
  end: number;
  pageviews: number;
  hosts: string[];
};

export const SITE_PAGEVIEWS_QUERY = `
query SitePageviews($account: string, $site: string, $host: string, $start: Time, $end: Time) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      summary: rumPageloadEventsAdaptiveGroups(limit: 1, filter: {
        siteTag: $site, requestHost: $host,
        datetime_geq: $start, datetime_lt: $end, bot: 0
      }) {
        count
      }
    }
  }
}`;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Site analytics response is invalid");
  }
  return value as Record<string, unknown>;
}

export function parseSiteAnalyticsSources(raw: string): SiteAnalyticsSource[] {
  const sites = record(JSON.parse(raw));
  if (Object.keys(sites).length !== SITE_ANALYTICS_HOSTS.length) {
    throw new Error("Site analytics must cover both production hosts");
  }
  return SITE_ANALYTICS_HOSTS.map((host) => {
    const siteTag = sites[host];
    if (typeof siteTag !== "string" || !/^[a-f0-9]{32}$/i.test(siteTag)) {
      throw new Error(`Site analytics tag is missing for ${host}`);
    }
    return { host, siteTag };
  });
}

export function parseSitePageviews(raw: unknown): number {
  const body = record(raw);
  if (body.errors != null && (!Array.isArray(body.errors) || body.errors.length > 0)) {
    throw new Error("Site analytics query failed");
  }
  const accounts = record(record(body.data).viewer).accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) {
    throw new Error("Site analytics account is unavailable");
  }
  const summary = record(accounts[0]).summary;
  if (!Array.isArray(summary) || summary.length > 1) {
    throw new Error("Site analytics aggregate is unavailable");
  }
  if (!summary.length) return 0;
  const count = record(summary[0]).count;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("Site analytics pageview count is invalid");
  }
  return count;
}

export async function fetchSiteAnalytics(
  account: string,
  token: string,
  sources: readonly SiteAnalyticsSource[],
  now = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<SiteAnalyticsPayload> {
  if (sources.length !== SITE_ANALYTICS_HOSTS.length ||
      SITE_ANALYTICS_HOSTS.some((host) => sources.filter((source) => source.host === host).length !== 1)) {
    throw new Error("Site analytics must cover both production hosts exactly once");
  }
  const day = 86_400_000;
  const end = Math.floor(now / day) * day;
  const start = end - 7 * day;
  const signal = AbortSignal.timeout(15_000);
  const counts = await Promise.all(sources.map(async ({ host, siteTag }) => {
    const response = await fetcher("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        query: SITE_PAGEVIEWS_QUERY,
        variables: {
          account, site: siteTag, host,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
        },
      }),
    });
    if (!response.ok) throw new Error(`Site analytics query failed (${response.status})`);
    return parseSitePageviews(await response.json());
  }));
  const pageviews = counts.reduce((sum, count) => sum + count, 0);
  if (!Number.isSafeInteger(pageviews)) throw new Error("Site analytics total is invalid");
  return { fetchedAt: now, start, end, pageviews, hosts: [...SITE_ANALYTICS_HOSTS] };
}
