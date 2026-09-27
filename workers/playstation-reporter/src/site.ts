import { isDryRun, type Env } from "./env";
import type { PlayedGamesReport, PresenceReport } from "./psn";
import type { TrophiesReport } from "./trophies";

export type PlaystationEnvelope = {
  version: 1;
  presence?: PresenceReport;
  playedGames?: PlayedGamesReport;
  trophies?: TrophiesReport;
};

type SiteEnvelope<T> = { ok?: boolean; error?: string; data?: T };
export type Receipt = { changed: boolean };

async function readEnvelope<T>(response: Response): Promise<T | undefined> {
  const body = (await response.json().catch(() => null)) as SiteEnvelope<T> | null;
  if (!response.ok || body?.ok !== true) {
    throw new Error(`站点返回 ${response.status}${body?.error ? `：${body.error}` : ""}`);
  }
  return body.data;
}

export async function deliver(env: Env, envelope: PlaystationEnvelope): Promise<Receipt> {
  if (isDryRun(env)) {
    console.log(JSON.stringify(envelope));
    return { changed: true };
  }

  // 经 Service Binding 直接调 api Worker 的 PlaystationIngest：不走公网，不带凭据，
  // 只有声明了这个 binding 的 Worker 调得到。超时照旧：奖杯那封大，给得宽一些
  const response = await withTimeout(
    env.API!.ingest(JSON.stringify(envelope)),
    envelope.trophies ? 30_000 : 15_000,
  );
  const data = await readEnvelope<{ changed?: boolean }>(response);
  return { changed: data?.changed === true };
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

/** 每个来源独立兜底；不让失败的连接数查询掩盖可见访客。 */
export async function headCount(request: (() => Promise<Response>) | undefined, field: "online" | "connections"): Promise<number> {
  if (!request) return 0;
  try {
    const body = await readQuery<Record<string, unknown>>(request());
    const value = body?.[field];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`invalid ${field}`);
    return value;
  } catch (error) {
    console.warn(JSON.stringify({ event: "playstation-head-count", field, error: error instanceof Error ? error.message : String(error) }));
    return 0;
  }
}

/** HA 报上来的主机电源状态；读不到就是 null＝不知道 */
type Power = { on: boolean; observedAt: number } | null;

/**
 * 主机通没通电。Home Assistant 那个开关翻面时上报给 API Worker，这里从
 * 「此刻在玩」那条读端点顺带取回来。
 *
 * **兜底方向和人头数相反**：人头数读不到当 0、只会变慢；这一份读不到当
 * 「不知道」、按开机走原来的三档。反过来把故障当关机会把卡片冻在闲档，
 * 机器明明开着却半小时才更新一次。
 */
export async function readPower(env: Env): Promise<Power> {
  if (!env.API) return null;
  try {
    const body = await readQuery<{ data?: { power?: unknown } }>(env.API.playingNow());
    const power = body?.data?.power as Record<string, unknown> | null | undefined;
    if (!power || typeof power.on !== "boolean") return null;
    const observedAt = power.observedAt;
    if (typeof observedAt !== "number" || !Number.isFinite(observedAt)) return null;
    return { on: power.on, observedAt };
  } catch (error) {
    console.warn(JSON.stringify({ event: "playstation-read-power", error: error instanceof Error ? error.message : String(error) }));
    return null;
  }
}

/** 计时包含响应体读取，RPC 没有 HTTP AbortSignal。 */
function readQuery<T>(response: Promise<Response>): Promise<T | null> {
  return withTimeout(response.then(async (result) => {
    if (!result.ok) throw new Error(`返回 ${result.status}`);
    return await result.json() as T | null;
  }), COUNT_TIMEOUT_MS);
}
