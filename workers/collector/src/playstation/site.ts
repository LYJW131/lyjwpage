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

/** 状态核心的回执：和 HTTP 上报同一份，2xx 且 `ok: true` 才算收下 */
function readReceipt(reply: { status: number; body: unknown }): Receipt {
  const body = (reply.body && typeof reply.body === "object" ? reply.body : null) as
    | { ok?: unknown; error?: unknown; data?: { changed?: unknown } }
    | null;
  if (reply.status < 200 || reply.status >= 300 || body?.ok !== true) {
    const error = typeof body?.error === "string" ? body.error : "";
    throw new Error(`站点返回 ${reply.status}${error ? `：${error}` : ""}`);
  }
  return { changed: body.data?.changed === true };
}

export async function deliver(env: Env, envelope: PlaystationEnvelope): Promise<Receipt> {
  if (isDryRun(env)) {
    console.log(JSON.stringify(envelope));
    return { changed: true };
  }

  // 经 Service Binding 调状态核心的 StateCore.ingest：不走公网，不带凭据，
  // 只有声明了这个 binding 的 Worker 调得到。奖杯那封大，超时给得宽一些
  const reply = await withTimeout(
    env.CORE.ingest("playstation", JSON.stringify(envelope)),
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

/** 每个来源独立兜底；不让失败的连接数查询掩盖可见访客。 */
export async function headCount(read: (() => Promise<number>) | undefined, field: "online" | "connections"): Promise<number> {
  if (!read) return 0;
  try {
    const value = await withTimeout(read(), COUNT_TIMEOUT_MS);
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`invalid ${field}`);
    return value;
  } catch (error) {
    console.warn(JSON.stringify({ event: "playstation-head-count", field, error: error instanceof Error ? error.message : String(error) }));
    return 0;
  }
}

/** online-counter 的 `GET /count`：计时包含响应体读取 */
export async function readOnlineCount(url: string): Promise<number> {
  const response = await fetch(url, { signal: AbortSignal.timeout(COUNT_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`返回 ${response.status}`);
  const body = (await response.json()) as { online?: unknown } | null;
  return body?.online as number;
}

/** HA 报上来的主机电源状态；读不到就是 null＝不知道 */
type Power = { on: boolean; observedAt: number } | null;

/**
 * 主机通没通电。Home Assistant 那个开关翻面时上报给状态核心，这里经 CORE 读回来。
 *
 * **兜底方向和人头数相反**：人头数读不到当 0、只会变慢；这一份读不到当
 * 「不知道」、按开机走原来的三档。反过来把故障当关机会把卡片冻在闲档，
 * 机器明明开着却半小时才更新一次。
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
