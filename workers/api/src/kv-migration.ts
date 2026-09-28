import { mirrorKey } from "@/lib/storage";
import type { TimezoneActivity, VibeCodingLimit, VibeCodingPlan } from "@/lib/types";
import type { AgentLimitsPayload } from "@/lib/vibecoding-limits";
import { mirror as credentialsMirror } from "@shared/apple-music-credentials";
import { readAppleMusicCredentialsFrom, writeAppleMusicCredentials } from "@shared/credentials";
import { LAG_KEYS, readLag, writeLag } from "@shared/lag";
import { withRequestState } from "@shared/request-state";
import { syncTelemetryState, telemetryState } from "@shared/telemetry";
import { requestStore, type Env } from "./runtime";

/**
 * 临时：把几份从 StateHub SQLite 挪到 KV 的数据搬过去一次。
 *
 * - Apple Music user token → 凭据 KV：Mac 只在令牌变了时才推。
 * - 时区 → 可滞后层：Mac 只在换时区时才推这个模块。
 * - 限额 → 可滞后层：容器上报器最慢一小时才来一封，搬过去免得卡片空一小时。
 *
 * KV 里已有就不动；搬完删掉 SQLite 那份，之后每分钟只剩几次 KV 读。生产搬完后
 * 随下一次清理连同本文件、旧的 SQLite 键定义一起删除。
 */
export async function migrateToKv(env: Env, ctx: ExecutionContext): Promise<void> {
  await withRequestState(() => requestStore.run({ env, ctx }, async () => {
    await Promise.all([
      moveCredentials(env),
      moveTimezone(env),
      moveLimits(env),
    ]);
  }));
}

async function moveCredentials(env: Env): Promise<void> {
  const kv = env.CREDENTIALS;
  if (!kv || await readAppleMusicCredentialsFrom(kv)) return;
  const stored = await credentialsMirror.get();
  if (!stored?.musicUserToken) return;
  await writeAppleMusicCredentials(kv, { musicUserToken: stored.musicUserToken, receivedAt: stored.receivedAt });
  await credentialsMirror.drop();
  console.log("[kv-migration] Apple Music user token moved to KV");
}

async function moveTimezone(env: Env): Promise<void> {
  const kv = env.LAG;
  if (!kv || await readLag(kv, LAG_KEYS.timezone)) return;
  await syncTelemetryState();
  const timezone: TimezoneActivity | null = telemetryState.activeModules.has("timezone") ? telemetryState.timezone : null;
  if (!timezone) return;
  await writeLag(kv, LAG_KEYS.timezone, { timezone }, telemetryState.timezoneReceivedAt || Date.now());
  console.log("[kv-migration] timezone moved to KV");
}

/** 旧的 SQLite 限额镜像（行上的收到时刻叫 pushedAt） */
const oldLimits = mirrorKey<{
  agents: Record<string, { plan: VibeCodingPlan | null; limits: VibeCodingLimit[]; limitsError: string | null; pushedAt: number }>;
  pushedAt: number;
}>(["vibecoding", "limits"], (state) => state.pushedAt);

async function moveLimits(env: Env): Promise<void> {
  const kv = env.LAG;
  if (!kv || await readLag(kv, LAG_KEYS.limits)) return;
  const stored = await oldLimits.get();
  if (!stored) return;
  const agents: AgentLimitsPayload["agents"] = {};
  for (const [id, row] of Object.entries(stored.agents)) {
    agents[id] = { plan: row.plan, limits: row.limits, limitsError: row.limitsError, updatedAt: row.pushedAt };
  }
  await writeLag(kv, LAG_KEYS.limits, { agents }, stored.pushedAt);
  await oldLimits.drop();
  console.log("[kv-migration] agent limits moved to KV");
}
