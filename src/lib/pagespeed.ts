import { site } from "@/lib/site";
import type { LighthouseVitals, PageSpeedPayload, PageSpeedSample } from "@/lib/vercel-deployments-types";

const ENDPOINT = "https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed";
/** 整份响应带着截图有 800 KB；只要评分和这几条审计，Worker 不必解一遍图。 */
const FIELDS = "captchaResult,lighthouseResult(categories/performance/score,audits)";
/**
 * 参与中位数的滚动窗口：只算这段时间里跑过的轮次，按小时一轮大约六个样本。
 *
 * 窗口用时间而不是条数定 —— Worker 停过一段时间之后，剩下的样本该是真的近期
 * 实测，不是几天前那几轮凑数。窗口里只剩一轮时中位数就是那一轮。
 */
const WINDOW_MS = 6 * 3_600_000;
/** 窗口内万一跑得比预期密（比如改了 cron），也不把无上限的历史塞进一条记录。 */
const MAX_SAMPLES = 12;
/**
 * 单端等多久。PSI 通常二十多秒，但 Google 那边的跑测机偶尔卡住：2026-09-28 有两轮
 * （17:08、22:08 UTC）在 60 秒处被自己掐断，两次都恰好 60000 ms，其余轮次正常。
 * 放宽到 120 秒：桌面、移动并行，一轮最坏也是这个数，仍在采集任务的时限之内
 * （workers/collector/src/jobs/pagespeed.ts 的 maxRuntimeMinutes，有测试盯着）。
 * 卡住的那次要落进自己的 catch 里（有日志），别拖到被平台掐断 —— 那种死法不留任何痕迹。
 */
export const PAGESPEED_TIMEOUT_MS = 120_000;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PageSpeed 结果格式无效");
  return value as Record<string, unknown>;
}

function numeric(audits: Record<string, unknown>, id: string): number | null {
  const raw = audits[id] == null ? null : record(audits[id]).numericValue;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
}

/**
 * 只取 Lighthouse 实验室数据。
 *
 * PSI 同时会返回 CrUX 真实用户字段（`loadingExperience`），但这个站的流量远不够
 * 进 CrUX 数据集，那两段是空的 —— 展示的是一台模拟设备上的单次实测，不是访客
 * 实际体验，所以没有 INP（它只有真实用户才测得到），用同一轮测出的 TBT 代替。
 *
 * 整轮跑通但个别审计测不出时按空值处理，不因为一个指标把整张表判死。
 */
export function parsePageSpeed(raw: unknown): LighthouseVitals {
  const response = record(raw);
  if (response.captchaResult != null && response.captchaResult !== "CAPTCHA_NOT_NEEDED") throw new Error("PageSpeed 要求人机验证");
  const lighthouse = record(response.lighthouseResult);
  const audits = record(lighthouse.audits);
  const performance = record(lighthouse.categories).performance;
  const ratio = performance == null ? null : record(performance).score;
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new Error("PageSpeed 性能评分缺失");
  const cls = numeric(audits, "cumulative-layout-shift");
  const round = (value: number | null) => value == null ? null : Math.round(value);
  return {
    score: Math.round(ratio * 100),
    lcpMs: round(numeric(audits, "largest-contentful-paint")),
    tbtMs: round(numeric(audits, "total-blocking-time")),
    cls: cls == null ? null : Number(cls.toFixed(3)),
    fcpMs: round(numeric(audits, "first-contentful-paint")),
    // Lighthouse 的 TTFB 审计叫 server-response-time，只计根文档
    ttfbMs: round(numeric(audits, "server-response-time")),
  };
}

/** 密钥只走查询参数（接口只认这一种），错误信息里只带状态码。 */
export async function fetchPageSpeed(url: string, strategy: "desktop" | "mobile", key: string): Promise<LighthouseVitals> {
  const endpoint = new URL(ENDPOINT);
  endpoint.search = new URLSearchParams({ url, strategy, category: "performance", fields: FIELDS, key }).toString();
  const response = await fetch(endpoint, { headers: { "User-Agent": "lyjwpage-pagespeed" }, signal: AbortSignal.timeout(PAGESPEED_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`PageSpeed 查询失败 (${response.status})`);
  return parsePageSpeed(await response.json());
}

function middle(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const half = sorted.length >> 1;
  // 偶数个取中间两个的平均，这是中位数本来的定义，不是随便挑一边
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

/**
 * 每一格各自取中位数，所以这一行不是某一轮的完整报告。
 *
 * 窗口里某几轮测不出某个指标时，那个格子只按测出来的那几轮算；一轮都没测出
 * 才是空。要的是「这个指标平时是多少」，逐格取中位数正好答这个。
 */
function summarize(samples: PageSpeedSample[], device: "desktop" | "mobile"): LighthouseVitals {
  const pick = (key: Exclude<keyof LighthouseVitals, "score">) =>
    middle(samples.map((row) => row[device][key]).filter((value): value is number => value != null));
  const round = (value: number | null) => value == null ? null : Math.round(value);
  const score = middle(samples.map((row) => row[device].score));
  if (score == null) throw new Error("PageSpeed 窗口内没有样本");
  const cls = pick("cls");
  return {
    score: Math.round(score),
    lcpMs: round(pick("lcpMs")), tbtMs: round(pick("tbtMs")),
    cls: cls == null ? null : Number(cls.toFixed(3)),
    fcpMs: round(pick("fcpMs")), ttfbMs: round(pick("ttfbMs")),
  };
}

/** 存进去的是自己写的 JSON，回来时只挡结构对不上的脏数据（升键、手改）。 */
function isSample(value: unknown): value is PageSpeedSample {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const vitals = (device: unknown) => !!device && typeof device === "object" && typeof (device as LighthouseVitals).score === "number";
  return typeof row.at === "number" && Number.isFinite(row.at) && vitals(row.desktop) && vitals(row.mobile);
}

/**
 * 把一轮实测并进滚动窗口，重算中位数。
 *
 * 单轮的波动不小 —— Google 那边的跑测机偶尔卡一下，TBT 和总分能跳出明显偏低的
 * 一轮。窗口里保留最近几小时的实测，逐格取中位数，一轮异常就被旁边几轮压住。
 * 代价是滞后：真的变慢了也要过半个窗口才在卡片上稳下来。
 */
export function mergePageSpeed(previous: unknown, next: PageSpeedSample): { history: PageSpeedSample[]; payload: PageSpeedPayload } {
  const history = [...(Array.isArray(previous) ? previous.filter(isSample) : []), next]
    .filter((row) => next.at - row.at < WINDOW_MS)
    .sort((a, b) => a.at - b.at)
    .slice(-MAX_SAMPLES);
  return {
    history,
    payload: {
      fetchedAt: next.at, url: site.url, samples: history.length, start: history[0].at,
      desktop: summarize(history, "desktop"), mobile: summarize(history, "mobile"),
    },
  };
}
