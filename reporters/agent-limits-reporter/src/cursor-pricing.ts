/**
 * Cursor 事件的公开 API 等值估价。费率和别名与 MacTelemetryHub
 * `CodingUsagePricing` 同一份 models.dev 快照（catalogVersion
 * `models.dev-6e5efcd056370b0853db07ce9b4e02391c8a2d55`）。
 * 不使用 Cursor 返回的 chargedCents / totalCents。
 *
 * 快照改编自 ccusage 的 models.dev 数据，MIT。
 * Copyright (c) 2025 ryoppippi / models.dev
 */

type Rates = {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheCreation: number | null;
};

type Price = {
  base: Rates;
  threshold?: number;
  longContext?: Rates;
};

function rates(
  input: number | null,
  output: number | null,
  cacheRead: number | null,
  cacheCreation: number | null,
): Rates {
  return { input, output, cacheRead, cacheCreation };
}

/** Antigravity 占位符。账本里的模型名走这一步，和 Mac 的年度拆分对得上。 */
const IDENTITY: Record<string, string> = {
  m318: "gemini-3.8-flash-high",
  m319: "gemini-3.8-flash-medium",
  m320: "gemini-3.8-flash-low",
  m322: "gemini-3.8-flash",
  m298: "gemini-3.7-flash-high",
  m299: "gemini-3.7-flash-medium",
  m300: "gemini-3.7-flash-low",
  m71: "gemini-3.6-flash-high",
  m72: "gemini-3.6-flash-medium",
  m73: "gemini-3.6-flash-low",
  m264: "gemini-3.6-flash-high",
  m265: "gemini-3.6-flash-medium",
  m266: "gemini-3.6-flash-low",
};

const ALIASES: Record<string, string> = {
  "claude-3-5-sonnet": "claude-3-5-sonnet-v2",
  "claude-3-5-sonnet-20240620": "claude-3-5-sonnet-v2",
  "claude-3-5-sonnet-20241022": "claude-3-5-sonnet-v2",
  "claude-3-7-sonnet-thinking": "claude-3-7-sonnet",
  "claude-4-1-opus": "claude-opus-4-1",
  "claude-4-5-haiku": "claude-haiku-4-5",
  "claude-4-5-haiku-thinking": "claude-haiku-4-5",
  "claude-4-5-opus": "claude-opus-4-5",
  "claude-4-5-opus-high-thinking": "claude-opus-4-5",
  "claude-4-5-sonnet": "claude-sonnet-4-5",
  "claude-4-5-sonnet-thinking": "claude-sonnet-4-5",
  "claude-4-6-opus": "claude-opus-4-6",
  "claude-4-6-opus-high": "claude-opus-4-6",
  "claude-4-6-opus-high-thinking": "claude-opus-4-6",
  "claude-4-6-opus-max": "claude-opus-4-6",
  "claude-4-6-opus-max-thinking": "claude-opus-4-6",
  "claude-4-6-sonnet": "claude-sonnet-4-6",
  "claude-4-6-sonnet-high-thinking": "claude-sonnet-4-6",
  "claude-4-6-sonnet-medium-thinking": "claude-sonnet-4-6",
  "claude-4-opus": "claude-opus-4",
  "claude-4-sonnet": "claude-sonnet-4",
  "claude-4-sonnet-thinking": "claude-sonnet-4",
  "claude-fable-5-1-thinking-high": "claude-fable-5-1",
  "claude-fable-5-thinking-high": "claude-fable-5",
  "claude-fable-5-thinking-xhigh": "claude-fable-5",
  "claude-opus-4-1-20250805": "claude-opus-4-1",
  "claude-opus-4-20250514": "claude-opus-4",
  "claude-opus-4-7-thinking-high": "claude-opus-4-7",
  "claude-opus-4-7-thinking-xhigh": "claude-opus-4-7",
  "claude-opus-4-8-thinking-high": "claude-opus-4-8",
  "claude-opus-5-low": "claude-opus-5",
  "claude-opus-5-thinking-high": "claude-opus-5",
  "claude-sonnet-4-20250514": "claude-sonnet-4",
  "claude-sonnet-5-thinking-high": "claude-sonnet-5",
  "cursor-grok-4-5-high": "grok-4-5",
  "cursor-grok-4-5-high-fast": "grok-4-5",
  "cursor-grok-4-6-high": "grok-4-6",
  "cursor-grok-4-6-high-fast": "grok-4-6",
  "cursor-grok-4-6-medium-fast": "grok-4-6",
  "cursor-grok-4-6-xhigh-fast": "grok-4-6",
  "glm-5-2-high": "glm-5-2",
  "gpt-5-1-codex-high": "gpt-5-1-codex",
  "gpt-5-2-xhigh": "gpt-5-2",
  "gpt-5-3-spark": "gpt-5-3-codex-spark",
  "gpt-5-5-extra-high": "gpt-5-5",
  "gpt-5-5-extra-high-fast": "gpt-5-5",
  "gpt-5-5-high": "gpt-5-5",
  "gpt-5-5-high-fast": "gpt-5-5",
  "gpt-5-5-medium": "gpt-5-5",
  "gpt-5-6": "gpt-5-6-sol",
  "gpt-5-6-sol-medium": "gpt-5-6-sol",
  "gpt-5-fast": "gpt-5",
  "grok-4-0709": "grok-4",
  "grok-4-5-fast-xhigh": "grok-4-5",
  "grok-4-5-high": "grok-4-5",
  "grok-4-5-xhigh": "grok-4-5",
  "premium (codex 5-3)": "gpt-5-3-codex",
  "gemini-3-6-flash-high": "gemini-3-6-flash",
  "gemini-3-6-flash-medium": "gemini-3-6-flash",
  "gemini-3-6-flash-low": "gemini-3-6-flash",
  "gemini-3-7-flash-high": "gemini-3-7-flash",
  "gemini-3-7-flash-medium": "gemini-3-7-flash",
  "gemini-3-7-flash-low": "gemini-3-7-flash",
  "gemini-3-8-flash-high": "gemini-3-8-flash",
  "gemini-3-8-flash-medium": "gemini-3-8-flash",
  "gemini-3-8-flash-low": "gemini-3-8-flash",
};

function price(base: Rates, threshold?: number, longContext?: Rates): Price {
  return { base, threshold, longContext };
}

const CATALOG: Record<string, Price> = {
  "claude-3-5-haiku-20241022": price(rates(0.8, 4, 0.08, 1)),
  "claude-3-7-sonnet-20250219": price(rates(3, 15, 0.3, 3.75)),
  "claude-3-haiku-20240307": price(rates(0.25, 1.25, 0.03, 0.3)),
  "claude-3-5-haiku": price(rates(0.8, 4, 0.08, 1)),
  "claude-3-5-sonnet-v2": price(rates(3, 15, 0.3, 3.75)),
  "claude-3-7-sonnet": price(rates(3, 15, 0.3, 3.75)),
  "claude-fable-5": price(rates(10, 50, 1, 12.5)),
  "claude-fable-5-1": price(rates(10, 50, 0.25, 12.5)),
  "claude-haiku-4-5": price(rates(1, 5, 0.1, 1.25)),
  "claude-haiku-4-5-20251001": price(rates(1, 5, 0.1, 1.25)),
  "claude-mythos-5": price(rates(10, 50, 1, 12.5)),
  "claude-opus-4": price(rates(15, 75, 1.5, 18.75)),
  "claude-opus-4-1": price(rates(15, 75, 1.5, 18.75)),
  "claude-opus-4-5": price(rates(5, 25, 0.5, 6.25)),
  "claude-opus-4-5-20251101": price(rates(5, 25, 0.5, 6.25)),
  "claude-opus-4-6": price(rates(5, 25, 0.5, 6.25)),
  "claude-opus-4-7": price(rates(5, 25, 0.5, 6.25)),
  "claude-opus-4-8": price(rates(5, 25, 0.5, 6.25)),
  "claude-opus-5": price(rates(5, 25, 0.5, 6.25)),
  "claude-sonnet-4": price(rates(3, 15, 0.3, 3.75), 200_000, rates(6, 22.5, 0.6, 7.5)),
  "claude-sonnet-4-5": price(rates(3, 15, 0.3, 3.75)),
  "claude-sonnet-4-5-20250929": price(rates(3, 15, 0.3, 3.75)),
  "claude-sonnet-4-6": price(rates(3, 15, 0.3, 3.75)),
  "claude-sonnet-5": price(rates(2, 10, 0.2, 2.5)),
  "gemini-2-0-flash-lite": price(rates(0.075, 0.3, null, null)),
  "gemini-2-5-flash": price(rates(0.3, 2.5, 0.03, null)),
  "gemini-2-5-flash-lite": price(rates(0.1, 0.4, 0.01, null)),
  "gemini-2-5-pro": price(rates(1.25, 10, 0.125, null), 200_000, rates(2.5, 15, 0.25, null)),
  "gemini-3-flash-preview": price(rates(0.5, 3, 0.05, null)),
  "gemini-3-pro": price(rates(2, 12, 0.2, null), 200_000, rates(4, 18, 0.4, null)),
  "gemini-3-pro-preview": price(rates(2, 12, 0.2, null), 200_000, rates(4, 18, 0.4, null)),
  "gemini-3-1-flash-lite": price(rates(0.25, 1.5, 0.025, null)),
  "gemini-3-1-flash-lite-preview": price(rates(0.25, 1.5, 0.025, null)),
  "gemini-3-1-pro-preview": price(rates(2, 12, 0.2, null), 200_000, rates(4, 18, 0.4, null)),
  "gemini-3-1-pro-preview-customtools": price(rates(2, 12, 0.2, null), 200_000, rates(4, 18, 0.4, null)),
  "gemini-3-5-flash": price(rates(1.5, 9, 0.15, null)),
  "gemini-3-5-flash-lite": price(rates(0.3, 2.5, 0.03, null)),
  "gemini-3-6-flash": price(rates(0.75, 3.75, 0.075, null)),
  "gemini-3-7-flash": price(rates(0.75, 3.75, 0.075, null)),
  "gemini-3-8-flash": price(rates(0.75, 3.75, 0.075, null)),
  "gemini-flash-latest": price(rates(0.75, 3.75, 0.075, null)),
  "gemini-flash-lite-latest": price(rates(0.3, 2.5, 0.03, null)),
  "glm-5-2": price(rates(1.4, 4.4, 0.28, 0)),
  "gpt-3-5-turbo": price(rates(0.5, 1.5, 0, null)),
  "gpt-4": price(rates(30, 60, null, null)),
  "gpt-4-turbo": price(rates(10, 30, null, null)),
  "gpt-4-1": price(rates(2, 8, 0.5, null)),
  "gpt-4-1-mini": price(rates(0.4, 1.6, 0.1, null)),
  "gpt-4-1-nano": price(rates(0.1, 0.4, 0.025, null)),
  "gpt-4o": price(rates(2.5, 10, 1.25, null)),
  "gpt-4o-2024-05-13": price(rates(5, 15, null, null)),
  "gpt-4o-2024-08-06": price(rates(2.5, 10, 1.25, null)),
  "gpt-4o-2024-11-20": price(rates(2.5, 10, 1.25, null)),
  "gpt-4o-mini": price(rates(0.15, 0.6, 0.075, null)),
  "gpt-5": price(rates(1.25, 10, 0.125, null)),
  "gpt-5-chat-latest": price(rates(1.25, 10, 0.125, null)),
  "gpt-5-codex": price(rates(1.25, 10, 0.13, null)),
  "gpt-5-mini": price(rates(0.25, 2, 0.025, null)),
  "gpt-5-nano": price(rates(0.05, 0.4, 0.005, null)),
  "gpt-5-pro": price(rates(15, 120, null, null)),
  "gpt-5-1": price(rates(1.25, 10, 0.125, null)),
  "gpt-5-1-chat-latest": price(rates(1.25, 10, 0.125, null)),
  "gpt-5-1-codex": price(rates(1.25, 10, 0.125, null)),
  "gpt-5-1-codex-max": price(rates(1.25, 10, 0.125, null)),
  "gpt-5-1-codex-mini": price(rates(0.25, 2, 0.025, null)),
  "gpt-5-2": price(rates(1.75, 14, 0.175, null)),
  "gpt-5-2-chat-latest": price(rates(1.75, 14, 0.175, null)),
  "gpt-5-2-codex": price(rates(1.75, 14, 0.175, null)),
  "gpt-5-2-pro": price(rates(21, 168, null, null)),
  "gpt-5-3-chat-latest": price(rates(1.75, 14, 0.175, null)),
  "gpt-5-3-codex": price(rates(1.75, 14, 0.175, null)),
  "gpt-5-3-codex-spark": price(rates(1.75, 14, 0.175, null)),
  "gpt-5-4": price(rates(2.5, 15, 0.25, null), 272_000, rates(5, 22.5, 0.5, null)),
  "gpt-5-4-mini": price(rates(0.75, 4.5, 0.075, null)),
  "gpt-5-4-nano": price(rates(0.2, 1.25, 0.02, null)),
  "gpt-5-4-pro": price(rates(30, 180, null, null), 272_000, rates(60, 270, null, null)),
  "gpt-5-5": price(rates(5, 30, 0.5, null), 272_000, rates(10, 45, 1, null)),
  "gpt-5-5-pro": price(rates(30, 180, null, null), 272_000, rates(60, 270, null, null)),
  "gpt-5-6-luna": price(rates(0.2, 1.2, 0.02, 0.25), 272_000, rates(0.4, 1.8, 0.04, 0.5)),
  "gpt-5-6-sol": price(rates(4, 20, 0.4, 5), 272_000, rates(8, 30, 0.8, 10)),
  "gpt-5-6-terra": price(rates(2, 12, 0.2, 2.5), 272_000, rates(4, 18, 0.4, 5)),
  "gpt-6-astra": price(rates(10, 50, 1, 12.5), 272_000, rates(20, 75, 2, 25)),
  "grok-3": price(rates(3, 15, 0.75, null)),
  "grok-3-mini": price(rates(0.3, 0.5, 0.075, null)),
  "grok-4": price(rates(3, 15, 0.75, null)),
  "grok-4-1-fast-non-reasoning": price(rates(0.2, 0.5, 0.05, null)),
  "grok-4-1-fast-reasoning": price(rates(0.2, 0.5, 0.05, null)),
  "grok-4-fast-non-reasoning": price(rates(0.2, 0.5, 0.05, null)),
  "grok-4-fast-reasoning": price(rates(0.2, 0.5, 0.05, null)),
  "grok-4-20-0309-non-reasoning": price(rates(1.25, 2.5, 0.2, null), 200_000, rates(2.5, 5, 0.4, null)),
  "grok-4-20-0309-reasoning": price(rates(1.25, 2.5, 0.2, null), 200_000, rates(2.5, 5, 0.4, null)),
  "grok-4-3": price(rates(1.25, 2.5, 0.2, null), 200_000, rates(2.5, 5, 0.4, null)),
  "grok-4-5": price(rates(2, 6, 0.3, null), 200_000, rates(4, 12, 0.6, null)),
  "grok-4-6": price(rates(2, 6, 0.5, null), 200_000, rates(4, 12, 1, null)),
  "grok-build-0-1": price(rates(1, 2, 0.2, null), 200_000, rates(2, 4, 0.4, null)),
  "grok-code-fast-1": price(rates(0.2, 1.5, 0.02, null)),
  "kimi-k2-5": price(rates(0.6, 3, 0.1, null)),
  o1: price(rates(15, 60, 7.5, null)),
  "o1-pro": price(rates(150, 600, null, null)),
  o3: price(rates(2, 8, 0.5, null)),
  "o3-mini": price(rates(1.1, 4.4, 0.55, null)),
  "o3-pro": price(rates(20, 80, null, null)),
  "o4-mini": price(rates(1.1, 4.4, 0.275, null)),
};

export function modelName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const key = trimmed.toLowerCase();
  const marker = key.includes("model_placeholder_")
    ? key.slice(key.indexOf("model_placeholder_") + "model_placeholder_".length)
    : key.includes("model-placeholder-")
      ? key.slice(key.indexOf("model-placeholder-") + "model-placeholder-".length)
      : key;
  return IDENTITY[marker] ?? trimmed;
}

function canonicalKey(model: string): string {
  let key = modelName(model).trim().toLowerCase();
  for (const prefix of ["anthropic/", "openai/", "google/", "x-ai/", "xai/", "deepseek/"]) {
    if (key.startsWith(prefix)) {
      key = key.slice(prefix.length);
      break;
    }
  }
  key = key.replaceAll(".", "-");
  return ALIASES[key] ?? key;
}

function scheduledPrice(model: string, atMs: number): Price | null {
  if (model !== "deepseek-v4-flash" && model !== "deepseek-v4-pro") return null;
  const flash = model === "deepseek-v4-flash";
  if (atMs < 1_786_896_000_000) {
    return price(flash ? rates(0.14, 0.28, 0.0028, 0.14) : rates(0.435, 0.87, 0.003625, 0.435));
  }
  const at = new Date(atMs);
  const weekday = at.getUTCDay();
  const hour = at.getUTCHours();
  const peak = weekday >= 1 && weekday <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
  const factor = peak ? 2 : 1;
  return price(
    flash
      ? rates(0.22 * factor, 0.66 * factor, 0.007 * factor, 0.22 * factor)
      : rates(0.66 * factor, 1.98 * factor, 0.022 * factor, 0.66 * factor),
  );
}

/** 一条请求的四列 token。估不出来返回 null，调用方把这一天的费用标成不完整。 */
export function estimateCursorCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number,
  atMs: number,
): number | null {
  if (!Number.isFinite(atMs) || atMs < 0) return null;
  const counts = [inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens];
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) return null;
  const cached = cacheReadTokens + cacheCreationTokens;
  const prompt = inputTokens + cached;
  if (!Number.isSafeInteger(cached) || !Number.isSafeInteger(prompt)) return null;
  const key = canonicalKey(model);
  const row = scheduledPrice(key, atMs) ?? CATALOG[key];
  if (!row) return null;
  const tier = row.threshold != null && prompt > row.threshold ? row.longContext : row.base;
  if (!tier) return null;
  const buckets: Array<[number, number | null]> = [
    [inputTokens, tier.input],
    [outputTokens, tier.output],
    [cacheReadTokens, tier.cacheRead],
    [cacheCreationTokens, tier.cacheCreation],
  ];
  let total = 0;
  for (const [count, rate] of buckets) {
    if (count <= 0) continue;
    if (rate == null || !Number.isFinite(rate) || rate < 0) return null;
    total += (count * rate) / 1_000_000;
  }
  return Number.isFinite(total) ? total : null;
}
