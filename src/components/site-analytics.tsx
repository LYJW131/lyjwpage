"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

/**
 * 自动化访问不计数。
 *
 * 站点状态卡的 PageSpeed 定时跑桌面、移动两端的 Lighthouse（见 lib/pagespeed），
 * 每一轮都是真实打开首页，Speed Insights 和 Web Analytics 都会照单记上 —— 事件
 * 按额度计，这一项就能吃掉大半。无头浏览器截图同理。
 * beforeSend 是函数，只能在客户端组件里传，所以单独包一层。
 */
const AUTOMATED = /Chrome-Lighthouse|HeadlessChrome/;

function automated(): boolean {
  return typeof navigator !== "undefined" && AUTOMATED.test(navigator.userAgent);
}

export function SiteAnalytics() {
  return (
    <>
      <Analytics beforeSend={(event) => (automated() ? null : event)} />
      {/* 事件按额度计；抽一半样本足够看趋势 */}
      <SpeedInsights sampleRate={0.5} beforeSend={(event) => (automated() ? null : event)} />
    </>
  );
}
