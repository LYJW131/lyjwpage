import { object, text } from "@shared/json";

export type PreparedAgentsOtlpUsage = {
  source: "agents-otlp";
  receivedAt: number;
  points: OtlpUsagePoint[];
};

export type OtlpAgentId = "claude" | "devin";

// Claude Code 可设成累计，只收累计；Devin CLI 只会发 delta（不认 temporality 偏好），按窗口水位去重后收。
const METRICS: Record<string, { agent: OtlpAgentId; metric: "tokens" | "cost"; acceptsDelta: boolean }> = {
  "claude_code.token.usage": { agent: "claude", metric: "tokens", acceptsDelta: false },
  "claude_code.cost.usage": { agent: "claude", metric: "cost", acceptsDelta: false },
  "devin.token.usage": { agent: "devin", metric: "tokens", acceptsDelta: true },
};
export const OTLP_TOKEN_TYPES = ["input", "output", "cacheRead", "cacheCreation"] as const;
export type OtlpTokenType = (typeof OTLP_TOKEN_TYPES)[number];

const DAY_MS = 86_400_000;
const MAX_POINTS = 5_000;
const OLDEST_POINT_DAYS = 400;

export type OtlpUsagePoint = {
  agent: OtlpAgentId;
  metric: "tokens" | "cost";
  type: OtlpTokenType | null;
  model: string | null;
  session: string;
  // 累计点的序列含起点（同一进程的计数器）；delta 点的不含，起点每个窗口都在走。
  series: string;
  startMs: number;
  timeMs: number;
  value: number;
  cumulative: boolean;
  acceptsDelta: boolean;
};

export function prepareAgentsOtlpUsage(raw: unknown, receivedAt = Date.now()): PreparedAgentsOtlpUsage {
  return { source: "agents-otlp", receivedAt, points: parseOtlpUsage(raw, receivedAt) };
}

function attributes(value: unknown): Map<string, string> {
  const result = new Map<string, string>();
  if (!Array.isArray(value)) return result;
  for (const entry of value) {
    const row = object(entry);
    const key = row ? text(row.key) : null;
    const inner = row ? object(row.value) : null;
    const stringValue = inner ? text(inner.stringValue) : null;
    if (key && stringValue) result.set(key, stringValue);
  }
  return result;
}

function digest(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function nanos(value: unknown): string | null {
  if (typeof value === "string" && /^\d{1,20}$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function pointValue(point: Record<string, unknown>): number | null {
  const raw = point.asDouble ?? point.asInt;
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function isCumulative(value: unknown): boolean | null {
  if (value === 2 || value === "AGGREGATION_TEMPORALITY_CUMULATIVE") return true;
  if (value === 1 || value === "AGGREGATION_TEMPORALITY_DELTA") return false;
  return null;
}

// OTLP exporter 不重试 4xx；只丢坏数据点，避免整封有效指标一起丢失。
export function parseOtlpUsage(input: unknown, now = Date.now()): OtlpUsagePoint[] {
  const root = object(input);
  if (!root || !Array.isArray(root.resourceMetrics)) throw new Error("OTLP 指标必须带 resourceMetrics 数组");
  const points: OtlpUsagePoint[] = [];
  for (const resource of root.resourceMetrics) {
    const scopes = object(resource)?.scopeMetrics;
    if (!Array.isArray(scopes)) continue;
    for (const scope of scopes) {
      const metrics = object(scope)?.metrics;
      if (!Array.isArray(metrics)) continue;
      for (const entry of metrics) {
        const metric = object(entry);
        const name = metric ? text(metric.name) : null;
        const known = name ? METRICS[name] : undefined;
        if (!name || !known) continue;
        const sum = object(metric?.sum);
        const cumulative = sum ? isCumulative(sum.aggregationTemporality) : null;
        if (!sum || cumulative == null || !Array.isArray(sum.dataPoints)) continue;
        for (const raw of sum.dataPoints) {
          const point = object(raw);
          if (!point) continue;
          const attrs = attributes(point.attributes);
          const value = pointValue(point);
          const start = nanos(point.startTimeUnixNano);
          const time = nanos(point.timeUnixNano);
          const sessionId = attrs.get("session.id") ?? null;
          if (value == null || !start || !time || !sessionId || sessionId.length > 200) continue;
          const timeMs = Number(BigInt(time) / BigInt(1_000_000));
          if (timeMs > now + DAY_MS || timeMs < now - OLDEST_POINT_DAYS * DAY_MS) continue;
          const model = attrs.get("model") ?? null;
          let type: OtlpTokenType | null = null;
          if (known.metric === "tokens") {
            const rawType = attrs.get("type");
            if (!rawType || !(OTLP_TOKEN_TYPES as readonly string[]).includes(rawType)) continue;
            type = rawType as OtlpTokenType;
          }
          const identity = [...attrs].sort(([left], [right]) => (left < right ? -1 : 1)).map(([key, entry]) => `${key}=${entry}`);
          points.push({
            agent: known.agent,
            metric: known.metric,
            type,
            model: model && model.length <= 200 ? model : null,
            // Claude 的摘要沿用不带前缀的旧写法，已存的会话表才认得出；其他 agent 加前缀，同名会话不互相顶掉。
            session: digest(known.agent === "claude" ? sessionId : `${known.agent}\u001f${sessionId}`),
            series: digest((cumulative ? [name, start, ...identity] : [name, "delta", ...identity]).join("\u001f")),
            startMs: Number(BigInt(start) / BigInt(1_000_000)),
            timeMs,
            value,
            cumulative,
            acceptsDelta: known.acceptsDelta,
          });
          if (points.length > MAX_POINTS) throw new Error("OTLP 指标数据点太多");
        }
      }
    }
  }
  return points;
}
