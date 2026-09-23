/**
 * `/api/status/sentry` 的公开形状：站点的错误量、会话、分钟 cron 心跳
 * 和真实用户的 Web Vitals。全部来自 Sentry，由 API Worker 用只读令牌取、缓存。
 *
 * 只放计数、比率和时刻，不放 issue 标题、报错内容和调用栈：那些可能带内部地址
 * 或访客浏览器里的东西，和 `app/error.tsx` 不把 error.message 端给访客是同一条线。
 * 所有时刻都是 epoch 毫秒（Sentry 给的是秒或 ISO 串，取数那一侧换算）。
 */

/** 12 小时和站点卡片服务格里 Vercel / Workers 的 Req、CPU 同一个窗口 */
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
  /** 参与统计的页面加载数（采样后的） */
  samples: number;
};

export type SentryStatusPayload = {
  fetchedAt: number;
  /** 站点（浏览器 + Vercel 函数）与 api Worker 两个项目，只算 production 环境 */
  errors: { site: SentryErrorSeries; worker: SentryErrorSeries } | null;
  /** 浏览器会话，最近 24 小时 */
  sessions: { crashFreeRate: number | null; count: number } | null;
  /** api Worker 分钟 cron 的心跳（production 环境） */
  cron: { status: "ok" | "error" | "missed" | "timeout" | "unknown"; lastCheckInAt: number | null } | null;
  /** 真实访客页面加载的 p75，最近 7 天 */
  vitals: SentryVitals | null;
};
