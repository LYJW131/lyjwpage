import { appendFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ENDPOINT = "https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed";
const FIELDS = "captchaResult,lighthouseResult(audits/largest-contentful-paint/numericValue)";

// 起点按当前生产中位数再留出 PageSpeed 单次抖动的余量，只拦明显退步；HTML 瘦身后逐步收紧到 2.5 s 的目标。
export const LCP_BUDGET_MS = 5_500;
export const WANTED_RUNS = 5;
export const MIN_RUNS = 3;
export const MAX_ATTEMPTS = 8;
// PageSpeed 对同一 URL 会在几十秒内直接返回上一次的结果，间隔短了等于重复计同一次。
export const RUN_GAP_MS = 45_000;
const TIMEOUT_MS = 240_000;

export type Verdict =
  | { status: "pass" | "over"; medianMs: number; samples: number[] }
  | { status: "inconclusive"; samples: number[] };

export function lcpOf(raw: unknown): number {
  const response = raw as { captchaResult?: string; lighthouseResult?: { audits?: Record<string, { numericValue?: unknown }> } };
  if (response.captchaResult && response.captchaResult !== "CAPTCHA_NOT_NEEDED") throw new Error("PageSpeed 要求人机验证");
  const value = response.lighthouseResult?.audits?.["largest-contentful-paint"]?.numericValue;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error("PageSpeed 结果里没有 LCP");
  return Math.round(value);
}

export function judge(samples: number[], budgetMs = LCP_BUDGET_MS): Verdict {
  if (samples.length < MIN_RUNS) return { status: "inconclusive", samples };
  const sorted = [...samples].sort((a, b) => a - b);
  const half = sorted.length >> 1;
  const medianMs = Math.round(sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2);
  return { status: medianMs > budgetMs ? "over" : "pass", medianMs, samples };
}

async function measure(url: string, key: string): Promise<number> {
  const endpoint = new URL(ENDPOINT);
  endpoint.search = new URLSearchParams({ url, strategy: "mobile", category: "performance", fields: FIELDS }).toString();
  const response = await fetch(endpoint, {
    headers: { "User-Agent": "lyjwpage-lcp-budget", "X-Goog-Api-Key": key },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`PageSpeed 查询失败 (${response.status})`);
  return lcpOf(await response.json());
}

async function main() {
  let url: string;
  try {
    const { positionals } = parseArgs({ allowPositionals: true, strict: true });
    if (positionals.length !== 1) throw new Error("需要且只要一个页面地址");
    url = new URL(positionals[0]).href;
  } catch (error) {
    console.error(`用法：node scripts/lcp-budget.ts <页面地址>（${error instanceof Error ? error.message : String(error)}）`);
    process.exit(2);
  }
  const key = process.env.PAGESPEED_API_KEY;
  if (!key) {
    console.log("::error::PAGESPEED_API_KEY is not configured");
    process.exit(1);
  }
  const samples: number[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && samples.length < WANTED_RUNS; attempt++) {
    if (attempt > 1) await delay(RUN_GAP_MS);
    try {
      const lcp = await measure(url, key);
      samples.push(lcp);
      console.log(`[lcp-budget] 第 ${attempt} 次：LCP ${lcp} ms`);
    } catch (error) {
      console.log(`[lcp-budget] 第 ${attempt} 次失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const verdict = judge(samples);
  const line = verdict.status === "inconclusive"
    ? `手机 LCP 只测成 ${samples.length} 次，不足 ${MIN_RUNS} 次，本次不判`
    : `手机 LCP 中位 ${verdict.medianMs} ms（${samples.join(" / ")}），预算 ${LCP_BUDGET_MS} ms`;
  console.log(`[lcp-budget] ${line}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### 首屏 LCP\n\n${url}：${line}\n`);
  if (verdict.status === "inconclusive") console.log(`::warning::${line}`);
  if (verdict.status === "over") {
    console.log(`::error::${line}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
