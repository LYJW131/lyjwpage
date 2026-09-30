// 公开状态只包含聚合数值与时刻；错误正文和调用栈可能泄露内部信息。

export type UptimeDay = {
  dayStart: number;
  success: number;
  failure: number;
  missed: number;
};

export type HealthSeries = {
  status: "up" | "down" | "unknown";
  availability24h: number | null;
  availability30d: number | null;
  days: UptimeDay[];
};

export type SentryUptime = HealthSeries & {
  url: string;
  intervalSeconds: number;
};

export type SentryErrorSeries = {
  count12h: number;
  count7d: number;
  unresolved: number;
};

export type SentryVitals = {
  lcpP75Ms: number | null;
  inpP75Ms: number | null;
  clsP75: number | null;
  fcpP75Ms: number | null;
  ttfbP75Ms: number | null;
  samples: number;
};

export type SentryStatusPayload = {
  fetchedAt: number;
  uptime: SentryUptime | null;
  heartbeat: HealthSeries | null;
  errors: { site: SentryErrorSeries; worker: SentryErrorSeries } | null;
  vitals: SentryVitals | null;
  blockAt?: Partial<Record<SentryBlock, number>>;
};

export type SentryBlock = "uptime" | "heartbeat" | "errors" | "vitals";
