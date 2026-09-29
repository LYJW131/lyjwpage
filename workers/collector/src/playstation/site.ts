import { preparePlaystationReport } from "@shared/ingest/playstation";
import type { CommitReply } from "@shared/state-core";

import { isDryRun, type Env } from "./env";
import type { PlayedGamesReport, PresenceReport } from "./psn";
import type { TrophiesReport } from "./trophies";

export type PlaystationEnvelope = {
  version: 1;
  presence?: PresenceReport;
  playedGames?: PlayedGamesReport;
  trophies?: TrophiesReport;
};

export type Receipt = { changed: boolean };

/** 状态核心的回执：初始化好了、整封收下（`ok: true`）才算送到 */
function readReceipt(reply: CommitReply): Receipt {
  if (!reply.ready) throw new Error("状态核心还没初始化");
  if (!reply.ok) throw new Error(`状态核心拒收：${reply.error}`);
  const data = (reply.data && typeof reply.data === "object" ? reply.data : null) as { changed?: unknown } | null;
  return { changed: data?.changed === true };
}

export async function deliver(env: Env, envelope: PlaystationEnvelope): Promise<Receipt> {
  if (isDryRun(env)) {
    console.log(JSON.stringify(envelope));
    return { changed: true };
  }

  // 信封是自己组的，收敛（shared/ingest/playstation.ts）在这边做完，状态核心只收命令：
  // 经 Service Binding 调 StateCore.commitIngest，不走公网、不带凭据，只有声明了这个
  // binding 的 Worker 调得到。奖杯那封大，超时给得宽一些
  const command = preparePlaystationReport(envelope);
  const reply = await withTimeout(
    env.CORE.commitIngest(command),
    envelope.trophies ? 30_000 : 15_000,
  );
  return readReceipt(reply);
}

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`上报超时（${ms} ms）`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 人头数读不回来不该拖着 tick 等，超时就当没人。 */
export const COUNT_TIMEOUT_MS = 2_500;

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * 推送房间的两个人头数，经 CORE 一次读回。读不到、超时一律当没人，只会让节奏变慢；
 * 某一个数不合法只把它自己降成 0，不连累另一个。
 */
export async function readAudience(env: Pick<Env, "CORE">): Promise<{ online: number; open: number }> {
  try {
    const audience = await withTimeout(env.CORE.audience(), COUNT_TIMEOUT_MS);
    return { online: count(audience?.online), open: count(audience?.connections) };
  } catch (error) {
    console.warn(JSON.stringify({ event: "playstation-head-count", error: error instanceof Error ? error.message : String(error) }));
    return { online: 0, open: 0 };
  }
}

/** HA 报上来的主机电源状态；读不到就是 null＝不知道 */
type Power = { on: boolean; observedAt: number } | null;

/**
 * 主机通没通电。Home Assistant 那个开关翻面时上报给状态核心，这里经 CORE 读回来。
 *
 * **兜底方向和人头数相反**：人头数读不到当 0、只会变慢；这一份读不到当
 * 「不知道」、按开机走三档。反过来把故障当关机会把卡片冻在闲档，
 * 机器明明开着却只按闲档更新。
 */
export async function readPower(env: Pick<Env, "CORE">): Promise<Power> {
  try {
    const power = await withTimeout(env.CORE.playstationPower(), COUNT_TIMEOUT_MS);
    if (!power || typeof power.on !== "boolean") return null;
    if (typeof power.observedAt !== "number" || !Number.isFinite(power.observedAt)) return null;
    return { on: power.on, observedAt: power.observedAt };
  } catch (error) {
    console.warn(JSON.stringify({ event: "playstation-read-power", error: error instanceof Error ? error.message : String(error) }));
    return null;
  }
}
