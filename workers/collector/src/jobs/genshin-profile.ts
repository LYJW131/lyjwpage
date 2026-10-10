import type { CollectorJobName } from "@shared/collector";
import { LAG_KEYS, readLag, writeLag, type GenshinProfile, type LagStore } from "@shared/lag";
import type { StateCoreRpc } from "@shared/state-core";
import { fetchGenshinProfile, GENSHIN_UID_PATTERN } from "@/lib/genshin";
import { genshinLayoutKey } from "@/lib/home-layout";

import type { Env } from "../env";
import { explain, ok, skipMissing, type Job, type JobResult } from "../job";

// shared/collector.ts#COLLECTOR_JOBS 还没有这个名字（该契约不在本次改动范围）；登记进去后去掉这层断言。
const NAME = "genshin-profile" as string as CollectorJobName;

let warnedInvalid = false;

export function resetGenshinWarningsForTests(): void {
  warnedInvalid = false;
}

// UID 只从绑定读，不进日志、不进 KV。
export async function refreshGenshinProfile(
  deps: {
    uid: string | undefined;
    lag: LagStore;
    core: Pick<StateCoreRpc, "revalidate">;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  },
  now = Date.now(),
): Promise<JobResult> {
  const uid = deps.uid?.trim();
  if (!uid) return skipMissing(NAME, ["GENSHIN_UID"]);
  if (!GENSHIN_UID_PATTERN.test(uid)) {
    if (!warnedInvalid) {
      warnedInvalid = true;
      console.warn(JSON.stringify({ event: "collector-skip", job: NAME, invalid: ["GENSHIN_UID"] }));
    }
    return { status: "skipped", detail: "invalid GENSHIN_UID" };
  }
  const profile = await fetchGenshinProfile(uid, deps.fetcher, deps.timeoutMs);
  const previous = await readLag<GenshinProfile>(deps.lag, LAG_KEYS.genshin);
  await writeLag(deps.lag, LAG_KEYS.genshin, profile, now);
  if (genshinLayoutKey(previous?.data) === genshinLayoutKey(profile)) return ok();
  try {
    await deps.core.revalidate(["genshin"]);
  } catch (error) {
    console.warn("[genshin-profile] revalidate", explain(error));
  }
  return ok("appeared");
}

export const genshinProfileJob: Job = {
  name: NAME,
  everyMinutes: 60,
  offset: 23,
  maxRuntimeMinutes: 2,
  run: ({ env, now }) =>
    refreshGenshinProfile({ uid: (env as Env & { GENSHIN_UID?: string }).GENSHIN_UID, lag: env.LAG, core: env.CORE }, now),
};
