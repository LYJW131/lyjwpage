import { get, put } from "@/lib/cache";
import { fetchWorkersMetrics } from "@/lib/cloudflare-workers";
import type { CloudflareWorkersPayload } from "@/lib/cloudflare-workers-types";
import { fetchVercelFunctions, type VercelFunctionsData } from "@/lib/vercel-metrics";

export type TrendsVercelCreds = { project: string; team: string; token: string };
export type TrendsCloudflareCreds = { account: string; token: string };
export type TrendsSide<T> = { data: T; windowStart: number; windowEnd: number; fetchedAt: number } | null;
export type ServiceTrends = {
  vercel: TrendsSide<VercelFunctionsData>;
  workers: TrendsSide<CloudflareWorkersPayload>;
};

const TTL_MS = 900_000;
const PARTIAL_TTL_MS = 60_000;
const LAST_GOOD_TTL_MS = 86_400_000;
const NEG_TTL_MS = 60_000;
const WINDOW_MS = 12 * 3_600_000;
const BUCKET_MS = 900_000;

const inflight = new Map<string, Promise<ServiceTrends>>();

function keyFor(vercel: TrendsVercelCreds | null, cf: TrendsCloudflareCreds | null): string {
  // 只放身份不放令牌；缺哪边键就不同，半边数据永远毒不掉整份。
  return `service-trends:v1:${vercel ? `${vercel.team}:${vercel.project}` : "-"}:${cf ? cf.account : "-"}`;
}

/**
 * Vercel 函数趋势与 Workers 趋势同一次刷新、同一窗口取数。
 *
 * 两条端点曾各自缓存、各自算窗口，15 分钟相位永远错开，横轴总差一格。
 * 这里一次 Promise.all 取两边，同一份缓存、同一窗口；正常时两边起止完全一致。
 * 单边失败只用自己的 last-good 补那一边，时间也保留原样；两边都无可用才抛，
 * 由调用方翻译成各自的降级（Vercel 组回空，Workers 端点报暂不可用）。
 */
export async function getServiceTrends(vercel: TrendsVercelCreds | null, cf: TrendsCloudflareCreds | null): Promise<ServiceTrends> {
  const key = keyFor(vercel, cf);
  const hit = await get<ServiceTrends>(key);
  if (hit) return hit;
  if (await get<{ at: number }>(`${key}:neg`)) throw new Error("服务趋势暂不可用");
  const running = inflight.get(key);
  if (running) return running;
  const promise = (async () => {
    try {
      const windowEnd = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
      const windowStart = windowEnd - WINDOW_MS;
      const [vercelFresh, workersFresh] = await Promise.all([
        (async (): Promise<VercelFunctionsData | null | undefined> => {
          if (!vercel) return undefined;
          try {
            return await fetchVercelFunctions(vercel.project, vercel.team, vercel.token, windowStart, windowEnd);
          } catch { return null; }
        })(),
        (async (): Promise<CloudflareWorkersPayload | null | undefined> => {
          if (!cf) return undefined;
          try {
            return await fetchWorkersMetrics(cf.account, cf.token, windowStart, windowEnd);
          } catch { return null; }
        })(),
      ]);
      const prev = await get<ServiceTrends>(`${key}:last-good`);
      const fetchedAt = Date.now();
      const result: ServiceTrends = {
        vercel: vercelFresh ? { data: vercelFresh, windowStart, windowEnd, fetchedAt } : (prev?.vercel ?? null),
        workers: workersFresh ? { data: workersFresh, windowStart, windowEnd, fetchedAt } : (prev?.workers ?? null),
      };
      if (!result.vercel && !result.workers) {
        await put(`${key}:neg`, { at: fetchedAt }, NEG_TTL_MS);
        throw new Error("服务趋势暂不可用");
      }
      const complete = vercelFresh !== null && workersFresh !== null;
      await put(key, result, complete ? TTL_MS : PARTIAL_TTL_MS);
      await put(`${key}:last-good`, result, LAST_GOOD_TTL_MS);
      return result;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}
