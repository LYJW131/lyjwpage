import { LAG_KEYS, readLag, writeLag } from "@shared/lag";
import { fetchSentryStatus, mergeSentryStatus, sentryClient } from "@/lib/sentry-status";
import type { SentryStatusPayload } from "@/lib/sentry-status-types";

import { ok, skipMissing, type Job } from "../job";

export const sentryStatusJob: Job = {
  name: "sentry-status",
  everyMinutes: 5,
  offset: 2,
  maxRuntimeMinutes: 2,
  async run({ env }) {
    const token = env.SENTRY_API_TOKEN?.trim();
    if (!token) return skipMissing("sentry-status", ["SENTRY_API_TOKEN"]);
    const previous = (await readLag<SentryStatusPayload>(env.LAG, LAG_KEYS.sentry))?.data ?? null;
    const next = await fetchSentryStatus(sentryClient(token));
    await writeLag(env.LAG, LAG_KEYS.sentry, mergeSentryStatus(next, previous), next.fetchedAt);
    const missing = (["uptime", "heartbeat", "errors", "vitals"] as const).filter((block) => next[block] == null);
    return ok(missing.length ? `${missing.join(", ")} carried over` : undefined);
  },
};
