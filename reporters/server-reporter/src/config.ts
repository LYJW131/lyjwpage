function ms(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} 必须是正数`);
  return value;
}

function flag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function cycleDay(): number {
  const raw = process.env.TRAFFIC_CYCLE_DAY?.trim();
  if (!raw) return 1;
  const day = Number(raw);
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    throw new Error("TRAFFIC_CYCLE_DAY 必须是 1–28 的整数（29 之后不是每个月都有）");
  }
  return day;
}

function quotaBytes(): number | null {
  const raw = process.env.TRAFFIC_QUOTA_BYTES?.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("TRAFFIC_QUOTA_BYTES 必须是正整数（字节）");
  return value;
}

function pathOr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined ? fallback : raw.trim();
}


export const config = {
  dryRun: flag("DRY_RUN"),

  site: {
    ingestUrl: process.env.SITE_INGEST_URL?.trim() ?? "",
    accessClientId: process.env.ACCESS_CLIENT_ID?.trim() ?? "",
    accessClientSecret: process.env.ACCESS_CLIENT_SECRET?.trim() ?? "",
  },

  hostId: process.env.HOST_ID?.trim() || "misaka-jp",
  location: process.env.HOST_LOCATION?.trim() || "Tokyo",
  hostRoot: (process.env.HOST_ROOT?.trim() ?? "").replace(/\/+$/, ""),

  intervalMs: ms("INTERVAL_MS", 60_000),
  pushTimeoutMs: ms("PUSH_TIMEOUT_MS", 10_000),

  trafficStatePath: pathOr("TRAFFIC_STATE_PATH", "/data/traffic.json"),
  cycleDay: cycleDay(),
  quotaBytes: quotaBytes(),

  pushLedgerPath: pathOr("PUSH_LEDGER_PATH", "/data/pushes.json"),
  reporterCommit: process.env.REPORTER_COMMIT?.trim() || null,
} as const;
