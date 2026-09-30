
export type AppVersionStatus = "current" | "stale" | "unknown";

export const APP_VERSION_PATH = "/api/version";

export type AppVersionPayload = {
  commit: string | null;
  message: string | null;
  builtAt: string | null;
};

export function resolveVersionStatus(
  pageCommit: string | null | undefined,
  latestCommit: string | null | undefined,
): AppVersionStatus {
  if (!pageCommit || !latestCommit) return "unknown";
  return pageCommit === latestCommit ? "current" : "stale";
}

export type AutoReloadTrigger = "background" | "page-crash";

export const AUTO_RELOAD_COOLDOWN_MS = 5 * 60_000;

export const AUTO_RELOAD_MEMORY = 8;

export const AUTO_RELOAD_MAX_TRIES = 2;

export const AUTO_RELOAD_RETRY_AFTER_MS = 30 * 60_000;

export type AutoReloadTry = { sha: string; count: number; at: number };

// 冷却起点独立于各版本的尝试记录；成功删除版本记录后仍须保留冷却。
export type AutoReloadLedger = {
  tries: AutoReloadTry[];
  at: number | null;
};

export const EMPTY_AUTO_RELOAD_LEDGER: AutoReloadLedger = { tries: [], at: null };

export function parseAutoReloadLedger(raw: string | null): AutoReloadLedger {
  if (!raw) return EMPTY_AUTO_RELOAD_LEDGER;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return EMPTY_AUTO_RELOAD_LEDGER;
    const row = value as { tries?: unknown; at?: unknown };
    const bySha = new Map<string, AutoReloadTry>();
    for (const item of Array.isArray(row.tries) ? row.tries : []) {
      const entry = item as Partial<Record<keyof AutoReloadTry, unknown>> | null;
      if (
        typeof entry?.sha !== "string" ||
        entry.sha.length === 0 ||
        !Number.isSafeInteger(entry.count) ||
        (entry.count as number) < 1 ||
        typeof entry.at !== "number" ||
        !Number.isFinite(entry.at)
      ) {
        continue;
      }
      bySha.delete(entry.sha);
      bySha.set(entry.sha, { sha: entry.sha, count: entry.count as number, at: entry.at });
    }
    const at = typeof row.at === "number" && Number.isFinite(row.at) ? row.at : null;
    return { tries: [...bySha.values()].slice(-AUTO_RELOAD_MEMORY), at };
  } catch {
    return EMPTY_AUTO_RELOAD_LEDGER;
  }
}

function currentRound(ledger: AutoReloadLedger, sha: string, now: number): AutoReloadTry | null {
  const entry = ledger.tries.find((known) => known.sha === sha);
  return entry && now - entry.at < AUTO_RELOAD_RETRY_AFTER_MS ? entry : null;
}

export function recordAutoReload(ledger: AutoReloadLedger, sha: string, now: number): AutoReloadLedger {
  const count = (currentRound(ledger, sha, now)?.count ?? 0) + 1;
  return { tries: [...ledger.tries.filter((known) => known.sha !== sha), { sha, count, at: now }].slice(-AUTO_RELOAD_MEMORY), at: now };
}

export function settleAutoReloadLedger(ledger: AutoReloadLedger, pageCommit: string | null | undefined): AutoReloadLedger {
  if (!pageCommit || !ledger.tries.some((known) => known.sha === pageCommit)) return ledger;
  return { ...ledger, tries: ledger.tries.filter((known) => known.sha !== pageCommit) };
}

// 校正未来时间后必须落盘，否则每次读取都会重新开始冷却，永远无法刷新。
export function rebaseAutoReloadLedger(ledger: AutoReloadLedger, now: number): AutoReloadLedger {
  const future = (at: number | null): at is number => at !== null && at > now;
  if (!future(ledger.at) && !ledger.tries.some((known) => future(known.at))) return ledger;
  return {
    tries: ledger.tries.map((known) => (future(known.at) ? { ...known, at: now } : known)),
    at: future(ledger.at) ? now : ledger.at,
  };
}

export type AutoReloadInput = {
  status: AppVersionStatus;
  latestCommit: string | null;
  trigger: AutoReloadTrigger;
  hidden: boolean;
  playerBusy: boolean;
  ledger: AutoReloadLedger | null;
  now: number;
};

export type AutoReloadDecision = { action: "reload" } | { action: "wait"; ms: number } | { action: "skip" };

export function autoReloadDecision(input: AutoReloadInput): AutoReloadDecision {
  const { latestCommit, now } = input;
  if (input.status !== "stale" || !latestCommit) return { action: "skip" };
  if (!input.ledger) return { action: "skip" };
  if (input.playerBusy) return { action: "skip" };
  if (input.trigger === "background" && !input.hidden) return { action: "skip" };
  const ledger = rebaseAutoReloadLedger(input.ledger, now);
  const round = currentRound(ledger, latestCommit, now);
  const untilRetry = round && round.count >= AUTO_RELOAD_MAX_TRIES ? round.at + AUTO_RELOAD_RETRY_AFTER_MS - now : 0;
  const untilCooldown = ledger.at === null ? 0 : ledger.at + AUTO_RELOAD_COOLDOWN_MS - now;
  const ms = Math.max(untilRetry, untilCooldown);
  return ms > 0 ? { action: "wait", ms } : { action: "reload" };
}
