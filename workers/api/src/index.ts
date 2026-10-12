import originWorker, { LivePushRoom as LivePushRoomBase, StateHub as StateHubBase } from "./origin-worker";
import { previewWorkerEnabled } from "./preview";
import { historyArchiveEnabled, pulseScoringEnabled, type Env } from "./runtime";
import { PulseArchive } from "./pulse-archive";
import { PulseScorer, clefDecide } from "./pulse-score";
import { DevOverrideReader as DevOverrideReaderBase } from "./dev-override-reader";
import { StateCore as StateCoreBase } from "./state-core";
import { PublicStatus as PublicStatusBase } from "./public-status";
import { HEARTBEAT_SERIES, recordCheck } from "@shared/health";
import { freshnessCheckDue, watchFreshness, type FreshnessEvent } from "./freshness-watch";
import { installApiPorts } from "./ports";
import type { PulseTick } from "./state-hub";

installApiPorts();

// Wrangler 迁移按导出名识别 DO，这些导出名不能改。
export const LivePushRoom = LivePushRoomBase;
export const StateHub = StateHubBase;
export const StateCore = StateCoreBase;
export const PublicStatus = PublicStatusBase;
export const DevOverrideReader = DevOverrideReaderBase;
export type { Env } from "./runtime";

const apiWorker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return originWorker.fetch(request, env, ctx);
  },
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    // Preview 仍可能连着共享归档，必须独立禁止 cron 写入。
    if (previewWorkerEnabled()) return;
    let ok = false;
    try {
      await runScheduled(env, event.scheduledTime);
      ok = true;
    } finally {
      if (historyArchiveEnabled(env)) {
        await recordCheck(env.HISTORY!, HEARTBEAT_SERIES, event.scheduledTime, ok)
          .catch((error: unknown) => console.error("[cron-heartbeat]", error));
      }
    }
  },
};

// 只有 StateHub 整个调不通才让这一轮记成失败心跳；子步骤失败只记一条错误日志，站点的 API 在线行不跟着闪。
async function runScheduled(env: Env, scheduledTime: number): Promise<void> {
  const archiving = historyArchiveEnabled(env);
  const scoring = pulseScoringEnabled(env);
  if (!archiving && !scoring) return;
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
  await Promise.all([
    archiving && new PulseArchive({ coordinator: hub, db: env.HISTORY! }).run(tick.archive)
      .catch((error: unknown) => stepFailed("pulse-archive", error)),
    scoring && new PulseScorer({ coordinator: hub, decide: clefDecide(env.AI!) }).run(tick.score)
      .catch((error: unknown) => stepFailed("pulse-score", error)),
  ]);
}

// Worker 时钟在同步计算中不走，测不出分步 CPU；只记每轮输入的条数与字节，cron CPU 再异常时用来区分输入变大和运行时本身。
function tickShape({ archive, score }: PulseTick) {
  const sized = (rows: readonly (string | null)[] = []) => [rows.length, rows.reduce((sum, row) => sum + (row?.length ?? 0), 0)];
  return {
    archive: Object.fromEntries(archive.streams.map((stream) => [stream.stream, {
      rows: sized(stream.rows),
      ...(stream.extra && { extra: sized(stream.extra) }),
      ...(stream.coding && { coding: sized(Object.values(stream.coding).flat()) }),
      ...(stream.error && { error: true }),
    }])),
    score: score && {
      assessments: sized(score.inputs.assessments),
      codingObservations: sized(score.inputs.codingObservations),
      cursorObservations: sized(score.inputs.cursorObservations),
      tokenBuckets: sized(Object.values(score.inputs.tokenBuckets)),
    },
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

export default apiWorker;
