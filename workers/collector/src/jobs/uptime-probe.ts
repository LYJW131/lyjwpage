import { recordCheck, SITE_UPTIME_URL, UPTIME_PROBE_EVERY_MINUTES, UPTIME_SERIES } from "@shared/health";

import { ok, skipMissing, type Job } from "../job";

const PROBE_TIMEOUT_MS = 10_000;

export async function probeSite(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher(SITE_UPTIME_URL, {
      cache: "no-store",
      headers: { "User-Agent": "lyjwpage-uptime-probe" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

export const uptimeProbeJob: Job = {
  name: "uptime-probe",
  everyMinutes: UPTIME_PROBE_EVERY_MINUTES,
  offset: 0,
  headStart: true,
  async run({ env, now, scheduled }) {
    if (!env.HISTORY) return skipMissing("uptime-probe", ["HISTORY"]);
    const up = await probeSite();
    // 手动触发不落库：每格的检查数要和排定次数对得上，多记一次会把漏跑抵掉。
    if (scheduled) await recordCheck(env.HISTORY, UPTIME_SERIES, now, up);
    return ok(up ? undefined : "site down");
  },
};
