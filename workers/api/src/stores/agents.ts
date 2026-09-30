import type { LiveEvent } from "@/lib/live-events";
import { fanout } from "@api/fanout";
import { recordCursorObservation } from "@api/stores/pulse-source-observations";
import type { PreparedAgentLimits } from "@shared/ingest/agents";

import { prepareCodingActivity, readCodingActivities } from "./coding-activity";
import { prepareCodingBuckets } from "./coding-buckets";
import { prepareCodingUsage } from "./coding-usage";

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
