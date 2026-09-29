import { askStorage, key, tellStorage } from "@/lib/storage";
import {
  codingActivityKey,
  codingOtlpKey,
  codingUsageKey,
  codingUsageRevisionKey,
  parseRevision,
  type StoredCodingActivity,
  type StoredOtlpCounters,
} from "@shared/coding-store";
import { normalizeCodingUsageReport, type CodingUsageAgent, type CodingUsageDay } from "@shared/coding-usage";
import type { StoredCodingUsageAgent } from "@shared/coding-usage-view";

/**
 * 一次性迁移：改契约前的 coding 用量键转成新键。线上确认转过之后，下一个提交删掉这个文件。
 *
 * 在云端 OTLP 提交和用量视图重算两处入口调用，幂等：做过一次就留个记号，之后每次只多一次读。
 *
 * 1. **云端累计计数器必须迁**：`vibecoding:claude-cloud-usage` 的 series / sessions / sessionCount 转成
 *    `coding:otlp`。做差对没有前值的累计序列取整值 —— 计数器丢了，每个活着的云端进程会把
 *    一生的累计量再加一遍。它的日桶转成 `coding:usage:agents-otlp` 的 claude 那格，最近时刻与模型
 *    转成 `coding:activity:agents-otlp`。
 * 2. 顺带把 `vibecoding:cursor-usage` 的日桶转成 `coding:usage:agents` 的 cursor 那格：容器下一轮本来
 *    就会整份覆盖，转了只是省掉那段断档。
 * 3. 旧键一律挂 14 天 TTL，闹钟自己回收；14 天内回滚旧版本还读得到旧值。
 *
 * 新键已经有值（新契约先收到了数据）的那一项不转，绝不盖掉新数据。转出来的账本照样过
 * 新契约的校验，旧数据不合规就跳过那一项、记一行日志；转出了账本就把 `coding:usage:revision`
 * 加一、账本记下它（同一个事务），D1 归档才看得见这几份。
 */

const MARKER_KEY = () => key("coding", "legacy-migrated");
const LEGACY_TTL_MS = 14 * 86_400_000;
const LEGACY_KEYS = () => [
  key("vibecoding", "usage"),
  key("vibecoding", "now"),
  key("vibecoding", "year"),
  key("vibecoding", "cursor-usage"),
  key("vibecoding", "cursor-now"),
  key("vibecoding", "claude-cloud-usage"),
  key("pulse", "coding-token-usage"),
  key("home-layout", "vibecoding"),
];

type LegacyDay = {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  apiEquivalentCostUSD: number;
  costComplete?: boolean;
  models?: Array<{ model: string; tokens: number }>;
};

type LegacyCloud = {
  pushedAt?: number;
  usage?: {
    days?: LegacyDay[];
    series?: StoredOtlpCounters["series"];
    sessions?: StoredOtlpCounters["sessions"];
    sessionCount?: number;
    lastPointAt?: number | null;
    lastModel?: string | null;
  };
};

type LegacyCursor = {
  pushedAt?: number;
  report?: {
    collectedAt?: string;
    state?: string;
    error?: string | null;
    warning?: string | null;
    costComplete?: boolean;
    days?: LegacyDay[];
  };
};

function parse<T>(raw: unknown): T | null {
  if (typeof raw !== "string") return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function convertDay(day: LegacyDay, costComplete: boolean): CodingUsageDay {
  return {
    date: day.date,
    inputTokens: day.inputTokens,
    outputTokens: day.outputTokens,
    cacheReadTokens: day.cacheReadTokens,
    cacheCreationTokens: day.cacheCreationTokens,
    reasoningTokens: 0,
    totalTokens: day.totalTokens,
    apiEquivalentCostUSD: day.apiEquivalentCostUSD,
    costComplete: day.costComplete ?? costComplete,
    models: day.models ?? [],
  };
}

/** 转出来的账本照新契约校验；不合规返回 null */
function validLedger(agent: CodingUsageAgent, receivedAt: number, now: number, revision: number): StoredCodingUsageAgent | null {
  try {
    const [checked] = normalizeCodingUsageReport({ agents: [agent] }, now).agents;
    return { ...checked, days: checked.days ?? [], receivedAt, revision };
  } catch (error) {
    console.warn("[migrate] coding usage legacy ledger skipped", agent.id, error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** 返回这次有没有转出新的账本（调用方据此决定要不要重算视图） */
export async function migrateLegacyCodingUsage(now: number): Promise<boolean> {
  const answered = await askStorage((storage) => storage.batch()
    .get(MARKER_KEY())
    .get(key("vibecoding", "claude-cloud-usage"))
    .get(key("vibecoding", "cursor-usage"))
    .get(codingOtlpKey())
    .get(codingActivityKey("agents-otlp"))
    .fields(codingUsageKey("agents-otlp"))
    .fields(codingUsageKey("agents"))
    .get(codingUsageRevisionKey())
    .execute());
  if (!answered.reachable) return false;
  const [marker, cloudRaw, cursorRaw, otlpRaw, cloudActivityRaw, cloudLedgers, accountLedgers, revisionRaw] = answered.value as [
    string | null, string | null, string | null, string | null, string | null, Record<string, string>, Record<string, string>, string | null,
  ];
  if (marker) return false;
  const revision = parseRevision(revisionRaw) + 1;

  const converted: string[] = [];
  let ledgers = false;
  await tellStorage(async (storage) => {
    const batch = storage.batch();
    const cloud = parse<LegacyCloud>(cloudRaw);
    const usage = cloud?.usage;
    const pushedAt = typeof cloud?.pushedAt === "number" ? cloud.pushedAt : now;
    if (usage && !otlpRaw) {
      const counters: StoredOtlpCounters = {
        series: usage.series ?? {},
        sessions: usage.sessions ?? {},
        sessionCount: usage.sessionCount ?? Object.keys(usage.sessions ?? {}).length,
      };
      batch.set(codingOtlpKey(), JSON.stringify(counters));
      converted.push("otlp-counters");
    }
    if (usage?.days && !cloudLedgers.claude) {
      const ledger = validLedger({
        id: "claude",
        state: "ok",
        collectedAt: usage.lastPointAt ?? pushedAt,
        error: null,
        warning: null,
        sessionCount: usage.sessionCount ?? null,
        days: usage.days.map((day) => convertDay(day, true)),
      }, pushedAt, now, revision);
      if (ledger) {
        batch.patch(codingUsageKey("agents-otlp"), { claude: JSON.stringify(ledger) });
        converted.push("otlp-days");
        ledgers = true;
      }
    }
    if (usage?.lastPointAt != null && !cloudActivityRaw) {
      const activity: StoredCodingActivity = {
        collectedAt: pushedAt,
        agents: [{ id: "claude", lastActivityAt: usage.lastPointAt, model: usage.lastModel ?? null }],
        receivedAt: pushedAt,
      };
      batch.set(codingActivityKey("agents-otlp"), JSON.stringify(activity));
      converted.push("otlp-activity");
    }

    const cursor = parse<LegacyCursor>(cursorRaw);
    const report = cursor?.report;
    if (report?.days && !accountLedgers.cursor) {
      const cursorAt = typeof cursor?.pushedAt === "number" ? cursor.pushedAt : now;
      const collectedAt = report.collectedAt ? Date.parse(report.collectedAt) : Number.NaN;
      const ledger = validLedger({
        id: "cursor",
        state: "ok",
        collectedAt: Number.isFinite(collectedAt) ? Math.min(collectedAt, now) : cursorAt,
        error: null,
        warning: report.state === "ok" ? report.warning ?? null : report.error ?? report.warning ?? null,
        sessionCount: null,
        days: report.days.map((day) => convertDay(day, report.costComplete ?? false)),
      }, cursorAt, now, revision);
      if (ledger) {
        batch.patch(codingUsageKey("agents"), { cursor: JSON.stringify(ledger) });
        converted.push("cursor-days");
        ledgers = true;
      }
    }

    if (ledgers) batch.set(codingUsageRevisionKey(), String(revision));
    for (const legacy of LEGACY_KEYS()) batch.expire(legacy, LEGACY_TTL_MS);
    batch.set(MARKER_KEY(), String(now), { ttlMs: LEGACY_TTL_MS });
    return batch.execute();
  });
  if (converted.length) console.log("[migrate] coding usage legacy converted", converted.join(","));
  return ledgers;
}
