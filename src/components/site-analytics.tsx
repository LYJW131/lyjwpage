"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

/**
 * 自动化访问不计数。
 *
 * 站点状态卡的 PageSpeed 每小时跑桌面、移动各一轮 Lighthouse（见 lib/pagespeed），
 * 一天 48 次真实打开首页，Speed Insights 和 Web Analytics 都会照单记上 —— Hobby
 * 的 Speed Insights 每月一万条，这一项就能吃掉大半。无头浏览器截图同理。
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
      {/* Hobby 每月 1 万条事件，按访问量计；抽一半样本足够看趋势 */}
      <SpeedInsights sampleRate={0.5} beforeSend={(event) => (automated() ? null : event)} />
    </>
  );
}
