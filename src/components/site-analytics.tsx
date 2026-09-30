"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const AUTOMATED = /Chrome-Lighthouse|HeadlessChrome/;

function automated(): boolean {
  return typeof navigator !== "undefined" && AUTOMATED.test(navigator.userAgent);
}

export function SiteAnalytics() {
  return (
    <>
      <Analytics beforeSend={(event) => (automated() ? null : event)} />
      <SpeedInsights sampleRate={0.5} beforeSend={(event) => (automated() ? null : event)} />
    </>
  );
}
