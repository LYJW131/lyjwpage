// 公开状态只包含聚合数值与时刻；错误正文和调用栈可能泄露内部信息。

// dayStart 是 UTC 零点的 epoch 毫秒；missed 是该有却没跑的检查，不算进可用率。
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

export type SiteUptime = HealthSeries & {
  url: string;
  intervalSeconds: number;
};

// 计数来自 Workers Observability 的采样查询，是估计值；unresolved 是 Workers Issues 里状态为 active 的 issue 数。
export type ErrorSeries = {
  count12h: number;
  count7d: number;
  unresolved: number;
};

// 真实访客 7 天 p75，来自 Cloudflare Web Analytics；samples 是 Web Vitals 事件数。
export type FieldVitals = {
  lcpP75Ms: number | null;
  inpP75Ms: number | null;
  clsP75: number | null;
  fcpP75Ms: number | null;
  ttfbP75Ms: number | null;
  samples: number;
};

export type HealthPayload = {
  fetchedAt: number;
  uptime: SiteUptime | null;
  heartbeat: HealthSeries | null;
  errors: { site: ErrorSeries; worker: ErrorSeries } | null;
  vitals: FieldVitals | null;
  blockAt?: Partial<Record<HealthBlock, number>>;
};

export type HealthBlock = "uptime" | "heartbeat" | "errors" | "vitals";
