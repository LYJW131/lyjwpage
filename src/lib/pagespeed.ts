import { site } from "@/lib/site";
import type { LighthouseVitals, PageSpeedPayload, PageSpeedSample } from "@/lib/vercel-deployments-types";

const ENDPOINT = "https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed";
const FIELDS = "captchaResult,lighthouseResult(categories/performance/score,audits)";
const WINDOW_MS = 6 * 3_600_000;
const MAX_SAMPLES = 12;
export const PAGESPEED_TIMEOUT_MS = 120_000;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PageSpeed 结果格式无效");
  return value as Record<string, unknown>;
}

function numeric(audits: Record<string, unknown>, id: string): number | null {
  const raw = audits[id] == null ? null : record(audits[id]).numericValue;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
}

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
    ttfbMs: round(numeric(audits, "server-response-time")),
  };
}

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
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

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

function isSample(value: unknown): value is PageSpeedSample {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const vitals = (device: unknown) => !!device && typeof device === "object" && typeof (device as LighthouseVitals).score === "number";
  return typeof row.at === "number" && Number.isFinite(row.at) && vitals(row.desktop) && vitals(row.mobile);
}

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
