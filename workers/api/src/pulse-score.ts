import { PULSE_SCORE_INTERVAL_MS, PULSE_SCORE_REFRESH_MS } from "@/lib/limits";
import { parsePulseSample, parsePulseScoreRecord, pulseKey, pulseScoreAttemptKey, pulseScoresKey } from "@/lib/pulse";
import {
  activityQuestionKey,
  buildPulseState,
  compressPulseWindow,
  pulseQuestions,
  pulseWindowAt,
  trendQuestionKey,
  type PulseDomainWindow,
} from "@/lib/pulse-window";
import {
  PULSE_DOMAINS,
  PULSE_TRENDS,
  type PulseDomain,
  type PulseSample,
  type PulseScoreRecord,
  type PulseTrend,
} from "@/lib/types";
import type { StorageClient } from "@shared/storage-client";

/**
 * 用 TypeSafe AI 的 Jev 评估模型，给五个域的最近 24 小时各打一个活动分。
 *
 * **Jev 只评窗口，不碰档位。** 每笔样本的 0–3 档仍由 `shared/pulse-levels.ts` 的
 * 确定性规则按上报那一刻算；这里问的是「这一整天有多活跃、在往哪边走」，
 * 那是一句判断，规则写不出来也不该写。
 *
 * 直连 TypeSafe 官方 API（`POST /v1/systemone`），**裸 HTTP**：为一次十分钟一趟的
 * 调用把 SDK 拖进 Worker 不值得，协议本身就是一个 POST；把握度就在每个答案里。
 *
 * 节奏由 cron 每分钟驱动，真正打出去最多十分钟一次，而且要有比上一份分更新的
 * 样本才打 —— 没人上报的那几个小时里不该产生任何调用。失败一律留着上一份分：
 * 卡片显示十分钟前的判断，好过空一格。
 */

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL_ID = "jev-latest";
/** 十秒还没回来就当这轮没有分。cron 一分钟一趟，不能让它挂在这里。 */
const TIMEOUT_MS = 10_000;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type JevAnswer = {
  type?: unknown;
  score?: unknown;
  choice?: unknown;
  confidence?: unknown;
};
type JevResponse = {
  answers?: Record<string, JevAnswer>;
};

function isTrend(value: unknown): value is PulseTrend {
  return typeof value === "string" && (PULSE_TRENDS as readonly string[]).includes(value);
}

/**
 * 把一次回答翻成要存的那份。
 *
 * 十道题缺一道、分不是有限数、趋势不在三选一里 —— 全都算这次失败，整份丢掉。
 * 半份分比没有分更糟：卡片会拿一个域的旧判断配另一个域的新泳道。
 */
export function parseJevScores(
  body: unknown,
  windows: Record<PulseDomain, PulseDomainWindow>,
  scoredAt: number,
  window: { from: number; to: number },
): PulseScoreRecord {
  const value = (body ?? {}) as JevResponse;
  const answers = value.answers ?? {};
  const domains = {} as PulseScoreRecord["domains"];
  for (const domain of PULSE_DOMAINS) {
    const activityKey = activityQuestionKey(domain);
    const activity = answers[activityKey];
    const trend = answers[trendQuestionKey(domain)];
    if (typeof activity?.score !== "number" || !Number.isFinite(activity.score)) {
      throw new Error(`${activityKey} 没给出分`);
    }
    if (!isTrend(trend?.choice)) throw new Error(`${trendQuestionKey(domain)} 不是三选一`);
    const confidence = activity.confidence;
    domains[domain] = {
      score: activity.score,
      confidence: typeof confidence === "number" && Number.isFinite(confidence) ? confidence : null,
      trend: trend.choice,
      latestSampleAt: windows[domain].latestSampleAt,
    };
  }
  return { scoredAt, window, domains };
}

/** 存着的那份之后有没有新样本。一个域有就够了。 */
export function hasFreshSamples(
  windows: Record<PulseDomain, PulseDomainWindow>,
  stored: PulseScoreRecord | null,
): boolean {
  if (!stored) return PULSE_DOMAINS.some((domain) => windows[domain].latestSampleAt != null);
  return PULSE_DOMAINS.some((domain) => {
    const latest = windows[domain].latestSampleAt;
    const scored = stored.domains[domain].latestSampleAt;
    return latest != null && (scored == null || latest > scored);
  });
}

export class PulseScorer {
  private storage: StorageClient;
  private apiKey: string;
  private fetch: typeof fetch;
  private now: () => number;
  private intervalMs: number;
  private refreshMs: number;
  private log: (error: unknown) => void;
  /**
   * 上一次**尝试**的时刻。节奏不能只看存着的 `scoredAt`：网关连挂十分钟的话它根本
   * 不前进，cron 会变成每分钟重试一次。内存里这份是快路径，存储里还有一份
   * （`pulse:scores:attempt`），DO 被回收再起来也接得上，不会在故障期间退化成每分钟一趟。
   */
  private lastAttemptAt = 0;
  private running = false;

  constructor(options: {
    storage: StorageClient;
    apiKey: string;
    fetch?: typeof fetch;
    now?: () => number;
    intervalMs?: number;
    refreshMs?: number;
    log?: (error: unknown) => void;
  }) {
    this.storage = options.storage;
    this.apiKey = options.apiKey;
    this.fetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.now = options.now ?? (() => Date.now());
    this.intervalMs = options.intervalMs ?? PULSE_SCORE_INTERVAL_MS;
    this.refreshMs = options.refreshMs ?? PULSE_SCORE_REFRESH_MS;
    this.log = options.log ?? ((error) => console.error("[pulse-score]", reason(error)));
  }

  /** 异常不外抛：调用方是 cron，不该因为打不出分而失败。 */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tick();
    } catch (error) {
      this.log(error);
    } finally {
      this.running = false;
    }
  }

  private async readSamples(): Promise<Record<PulseDomain, PulseSample[]>> {
    const pipe = this.storage.batch();
    for (const domain of PULSE_DOMAINS) pipe.listRange(pulseKey(domain), 0, -1);
    const rows = await pipe.execute();
    const series = {} as Record<PulseDomain, PulseSample[]>;
    PULSE_DOMAINS.forEach((domain, index) => {
      const raw = Array.isArray(rows[index]) ? (rows[index] as unknown[]) : [];
      const samples: PulseSample[] = [];
      for (const line of raw) {
        const sample = typeof line === "string" ? parsePulseSample(line) : null;
        if (sample) samples.push(sample);
      }
      series[domain] = samples;
    });
    return series;
  }

  private async tick(): Promise<void> {
    const now = this.now();
    const stored = parsePulseScoreRecord(await this.storage.get(pulseScoresKey()));
    const attempted = Number(await this.storage.get(pulseScoreAttemptKey())) || 0;
    const lastAt = Math.max(stored?.scoredAt ?? 0, this.lastAttemptAt, attempted);
    if (now - lastAt < this.intervalMs) return;

    const samples = await this.readSamples();
    const window = pulseWindowAt(now);
    const windows = {} as Record<PulseDomain, PulseDomainWindow>;
    for (const domain of PULSE_DOMAINS) {
      windows[domain] = compressPulseWindow(samples[domain], window);
    }
    // 没有新上报时不调用：同一份窗口再问一遍只会拿回同一个判断。
    // 例外是分已经放了一小时：窗口跟着时间走，昨天的活动会滑出去，分得跟着重算，
    // 否则泳道空了、分还停在旧判断上。窗口里一笔样本都没有时连这条也省掉。
    const anySamples = PULSE_DOMAINS.some((domain) => windows[domain].latestSampleAt != null);
    const aged = stored != null && now - stored.scoredAt >= this.refreshMs;
    if (!hasFreshSamples(windows, stored) && !(aged && anySamples)) return;

    // 打出去之前就记上（内存 + 存储）：网关挂着的时候，下一分钟不该再来一趟
    this.lastAttemptAt = now;
    await this.storage.set(pulseScoreAttemptKey(), String(now));
    const body = await this.ask(windows, window);
    const record = parseJevScores(body, windows, now, window);
    await this.storage.set(pulseScoresKey(), JSON.stringify(record));
  }

  private async ask(
    windows: Record<PulseDomain, PulseDomainWindow>,
    window: { from: number; to: number },
  ): Promise<unknown> {
    const response = await this.fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL_ID,
        state: buildPulseState(windows, window),
        questions: pulseQuestions(),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Jev HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    return response.json();
  }
}
