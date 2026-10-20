import { historyArchive, type Env } from "./runtime";
import { PulseArchive } from "./pulse-archive";
import { freshnessCheckDue, watchFreshness, type FreshnessEvent } from "./freshness-watch";
import type { PulseTick } from "./state-hub";

// 只有 StateHub 整个调不通才让这一轮记成失败心跳；子步骤失败只记一条错误日志，站点的 Core 在线行不跟着闪。
export async function runCronRound(env: Env, scheduledTime: number): Promise<void> {
  const db = historyArchive(env);
  if (!db) return;
  const hub = env.STATE.get(env.STATE.idFromName("global"));
  const [ticked] = await Promise.allSettled([
    hub.pulseTick(),
    env.LAG && freshnessCheckDue(scheduledTime) && watchFreshness({
      now: Date.now(),
      lag: env.LAG,
      hubRead: (commands) => hub.publicRead(commands),
      emit: reportFreshness,
    }).catch((error: unknown) => stepFailed("freshness-watch", error)),
  ]);
  if (ticked.status === "rejected") throw ticked.reason;
  const tick = ticked.value;
  console.info("[cron-shape]", JSON.stringify(tickShape(tick)));
  await new PulseArchive({ coordinator: hub, db }).run(tick.archive)
    .catch((error: unknown) => stepFailed("pulse-archive", error));
}

// Worker 时钟在同步计算中不走，测不出分步 CPU；只记每轮输入的条数与字节，cron CPU 再异常时用来区分输入变大和运行时本身。
function tickShape({ archive }: PulseTick) {
  const sized = (rows: readonly (string | null)[] = []) => [rows.length, rows.reduce((sum, row) => sum + (row?.length ?? 0), 0)];
  return {
    archive: Object.fromEntries(archive.streams.map((stream) => [stream.stream, {
      rows: sized(stream.rows),
      ...(stream.extra && { extra: sized(stream.extra) }),
      ...(stream.coding && { coding: sized(Object.values(stream.coding).flat()) }),
      ...(stream.error && { error: true }),
    }])),
  };
}

function stepFailed(step: string, error: unknown): void {
  console.error(`[cron-step] ${step}`, error);
}

// 断流记 error 级，Workers Issues 按来源各开一条；恢复只记 info，不进 Issues。
function reportFreshness({ source, state, lastSeenAt, ageMs, thresholdMs }: FreshnessEvent): void {
  const detail = { source, lastSeenAt: new Date(lastSeenAt).toISOString(), ageMinutes: Math.round(ageMs / 60_000), thresholdMinutes: thresholdMs / 60_000 };
  if (state === "stale") console.error(`Feed stale: ${source}`, JSON.stringify(detail));
  else console.info(`Feed recovered: ${source}`, JSON.stringify(detail));
}
