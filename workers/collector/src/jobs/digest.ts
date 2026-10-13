import type { DigestRecord, DigestRpc } from "@shared/digest";
import { LAG_KEYS, readLag, writeLag, type LagStore } from "@shared/lag";
import type { StateCoreRpc } from "@shared/state-core";

import { explain, ok, skipMissing, type Job, type JobResult } from "../job";

// 输入没变也重写一次：updatedAt 是浏览器判过时的依据，夜里没新事可写不等于摘要坏了。
export async function refreshDigest(
  deps: { lag: LagStore; core: Pick<StateCoreRpc, "revalidate">; digest: Pick<DigestRpc, "compose"> },
  now: number,
): Promise<JobResult> {
  const previous = await readLag<DigestRecord>(deps.lag, LAG_KEYS.digest);
  const outcome = await deps.digest.compose({ previousInputHash: previous?.data.inputHash ?? null });
  if (outcome.status === "unconfigured") return skipMissing("digest", ["ANTHROPIC_API_KEY on ai"]);
  if (outcome.status === "unchanged") {
    if (previous) await writeLag(deps.lag, LAG_KEYS.digest, previous.data, now);
    return ok("unchanged");
  }
  await writeLag(deps.lag, LAG_KEYS.digest, outcome.digest, now);
  // 首屏缓存只在卡片换形时失效：第一份摘要、摘要与时钟（quiet）互换；只换标题和数字的等轮询刷新。
  if (!previous || Boolean(previous.data.quiet) !== Boolean(outcome.digest.quiet)) {
    try {
      await deps.core.revalidate(["digest"]);
    } catch (error) {
      console.warn("[digest] revalidate", explain(error));
    }
  }
  return ok("composed");
}

export const digestJob: Job = {
  name: "digest",
  everyMinutes: 60,
  offset: 5,
  maxRuntimeMinutes: 2,
  run: ({ env, now }) => env.DIGEST
    ? refreshDigest({ lag: env.LAG, core: env.CORE, digest: env.DIGEST }, now)
    : Promise.resolve(skipMissing("digest", ["DIGEST"])),
};
