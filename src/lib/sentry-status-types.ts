/**
 * `/api/status/sentry` 的公开形状：站点的在线率、站点与 api Worker 的错误量、真实用户的 Web Vitals。全部来自 Sentry，由 API Worker 用只读令牌取、缓存。
 *
 * 只放计数、比率和时刻，不放 issue 标题、报错内容和调用栈：那些可能带内部地址
 * 或访客浏览器里的东西，和 `app/error.tsx` 不把 error.message 端给访客是同一条线。
 * 所有时刻都是 epoch 毫秒（Sentry 给的是秒或 ISO 串，取数那一侧换算）。
 */

export type UptimeDay = {
  /** 这一天（UTC）零点 */
  dayStart: number;
  success: number;
  failure: number;
  /** 探测没按时跑成（Sentry 那边的问题），不算站点宕机 */
  missed: number;
};

export type SentryUptime = {
  url: string;
  intervalSeconds: number;
  /** 成功探测 / (成功 + 失败)，没有样本是 null */
  availability24h: number | null;
  availability30d: number | null;
  /** 最近 30 天，旧的在前；监测开通前的日子 success/failure 都是 0 */
  days: UptimeDay[];
};

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
  uptime: SentryUptime | null;
  /** 站点（浏览器 + Vercel 函数）与 api Worker 两个项目，只算 production 环境 */
  errors: { site: SentryErrorSeries; worker: SentryErrorSeries } | null;
  /** 真实访客页面加载的 p75，最近 7 天 */
  vitals: SentryVitals | null;
};
